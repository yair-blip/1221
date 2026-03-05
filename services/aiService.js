'use strict';

require('dotenv').config();
const { OpenAI } = require('openai');
const { SERVICE_PROFILES } = require('./configService');
const logger = require('./logger');

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI client — auto-detects OpenAI vs Azure OpenAI from environment
// ─────────────────────────────────────────────────────────────────────────────
const useAzure = !!(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_KEY);

const openai = useAzure
    ? new OpenAI({
        apiKey: process.env.AZURE_OPENAI_KEY,
        baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT}`,
        defaultQuery: { 'api-version': process.env.AZURE_OPENAI_API_VERSION || '2024-02-01' },
        defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_KEY },
    })
    : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL = useAzure
    ? (process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o')
    : (process.env.OPENAI_MODEL || 'gpt-4o');

logger.info(`[AI] Provider: ${useAzure ? 'Azure OpenAI' : 'OpenAI'} | Model: ${MODEL}`);

// Validate that at least one API key is configured
if (!useAzure && !process.env.OPENAI_API_KEY) {
    logger.error('[AI] CRITICAL: OPENAI_API_KEY is not set. AI replies will fail.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const MAX_HISTORY = 20;

function safeJson(text, fallback = {}) {
    try {
        return JSON.parse(text.replace(/```json[\s\S]*?```|```/g, '').trim());
    } catch {
        return fallback;
    }
}

function langLabel(lang) {
    if (lang === 'he') return 'Hebrew (עברית)';
    if (lang === 'ar') return 'Arabic (العربية)';
    return 'English';
}

// ─────────────────────────────────────────────────────────────────────────────
// getAIResponse
// Sends the full conversation to the LLM and returns ONLY the reply text.
// The system prompt is structured so the model never outputs technical info.
// ─────────────────────────────────────────────────────────────────────────────
async function getAIResponse(messages, currentService = 'General Support', nextField = null, collectedData = {}, lang = 'en') {
    const profile = SERVICE_PROFILES[currentService] || SERVICE_PROFILES['General Support'];
    const remaining = profile.requiredFields.filter(f => !collectedData[f]);
    const allDone = remaining.length === 0;

    // Determine what the bot should focus on this turn
    let taskGuidance;
    if (allDone) {
        taskGuidance = `You have already collected all the information you need from this customer: ${JSON.stringify(collectedData, null, 2)}.
Now thank them warmly, briefly confirm what was collected, and let them know a specialist will follow up with them shortly.`;
    } else if (nextField) {
        taskGuidance = `You need to collect the customer's "${nextField}" in this message.
Do NOT ask for any other field — focus only on "${nextField}".
Information already collected: ${JSON.stringify(collectedData)}.
Still needed: ${remaining.join(', ')}.`;
    } else {
        taskGuidance = `${profile.prompt}
Information already collected: ${JSON.stringify(collectedData)}.
Information still needed: ${remaining.join(', ')}.`;
    }

    const system = `You are a helpful, professional customer service assistant for Bar-Tech — a technology company.
Your department: ${currentService}
Your communication style: ${profile.tone}

LANGUAGE — CRITICAL:
You MUST reply in ${langLabel(lang)} only. Do not switch languages. Do not mix languages.
The customer is writing in ${langLabel(lang)}, so your response must also be in ${langLabel(lang)}.

YOUR TASK THIS TURN:
${taskGuidance}

ADDITIONAL RULES:
- If the customer asks to speak with a human, a person, an agent, or uses phrases like: ${profile.handoffRules.join(', ')}, respond warmly that you are connecting them to a human specialist right now. Do not try to resolve the issue yourself at that point.
- Ask for only ONE piece of information per message. Never ask two questions at once.
- Be warm, concise, and professional. Keep responses to 2–3 sentences maximum.
- Do not invent prices, policies, or details you do not know.
- If directly asked whether you are a bot or AI, answer honestly in one sentence, then continue helping.

OUTPUT FORMAT — CRITICAL:
Your response must contain ONLY the message text the customer will read.
Do NOT include: labels, prefixes (like "Bot:", "AI:", "Response:", "Assistant:"), internal notes, technical descriptions, workflow steps, JSON, or any meta-commentary.
Write exactly what you would say to the customer, nothing more, nothing less.`;

    const trimmed = messages.slice(-MAX_HISTORY);
    logger.info(`[AI] Calling ${MODEL} with ${trimmed.length} messages for service: ${currentService}`);

    const completion = await openai.chat.completions.create({
        model: MODEL,
        messages: [{ role: 'system', content: system }, ...trimmed],
        max_tokens: 400,
        temperature: 0.4,
    });


    const reply = completion.choices[0].message.content.trim();
    logger.info(`[AI] Got reply (${reply.length} chars)`);
    return reply;
}

// ─────────────────────────────────────────────────────────────────────────────
// extractDataFromMessages
// Uses the LLM to extract specific field values from conversation history.
// Returns a JSON object — never sends this to the customer.
// ─────────────────────────────────────────────────────────────────────────────
async function extractDataFromMessages(messages, fields) {
    if (!messages.length || !fields.length) return {};

    const trimmed = messages.slice(-MAX_HISTORY);
    const system = `You are a precise data extraction engine. 
Analyze the conversation and extract values for these fields: ${fields.join(', ')}.
Return ONLY a valid JSON object with exactly these keys. Set a field to null if the customer has not mentioned it yet.
Never invent or guess values. Only extract what was explicitly stated by the customer.
Example output: { "name": "Ahmed Ali", "phone": "+971501234567", "issueDescription": "Screen is cracked" }`;

    const completion = await openai.chat.completions.create({
        model: MODEL,
        messages: [{ role: 'system', content: system }, ...trimmed],
        response_format: { type: 'json_object' },
        max_tokens: 400,
        temperature: 0,
    });

    return safeJson(completion.choices[0].message.content, {});
}

// ─────────────────────────────────────────────────────────────────────────────
// generateHandoffSummary
// Creates a brief English briefing for the human agent taking over.
// Never shown to the customer.
// ─────────────────────────────────────────────────────────────────────────────
async function generateHandoffSummary(messages) {
    if (!messages.length) return 'No conversation history available.';

    const trimmed = messages.slice(-MAX_HISTORY);
    const system = `You are writing a briefing for a human support agent who is taking over this conversation.
Write 3–4 sentences in English (regardless of the conversation language) covering:
1. The customer's main issue or request
2. What information has already been collected
3. Why the handoff was triggered
Be factual and concise. Do not include greetings or sign-offs.`;

    const completion = await openai.chat.completions.create({
        model: MODEL,
        messages: [{ role: 'system', content: system }, ...trimmed],
        max_tokens: 200,
        temperature: 0.2,
    });

    return completion.choices[0].message.content.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// analyzeSentimentAndUrgency
// Returns structured sentiment data — never shown to the customer.
// ─────────────────────────────────────────────────────────────────────────────
async function analyzeSentimentAndUrgency(messages) {
    const userMsgs = messages.filter(m => m.role === 'user').slice(-5);
    if (!userMsgs.length) {
        return { sentiment: 'neutral', urgency: 'low', shouldHandoff: false };
    }

    const system = `Analyze the sentiment and urgency of the customer messages.
Return ONLY a valid JSON object with exactly these keys and allowed values:
{
  "sentiment": "positive" | "neutral" | "frustrated",
  "urgency": "low" | "medium" | "high",
  "shouldHandoff": true | false
}
Set shouldHandoff to true if sentiment is "frustrated" OR urgency is "high".
Do not include any other text or explanation — only the JSON object.`;

    const completion = await openai.chat.completions.create({
        model: MODEL,
        messages: [{ role: 'system', content: system }, ...userMsgs],
        response_format: { type: 'json_object' },
        max_tokens: 80,
        temperature: 0,
    });

    return safeJson(
        completion.choices[0].message.content,
        { sentiment: 'neutral', urgency: 'low', shouldHandoff: false }
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// analyzeImage  (GPT-4o Vision)
// Called when a customer sends an image via WhatsApp.
// Returns a descriptive reply in the customer's language.
//
// @param {string}   imageUrl   Public URL of the image (Meta CDN link)
// @param {string}   lang       'en' | 'he' | 'ar'
// @param {string}   service    Inbox / service profile name
// @param {string[]} history    Last few text messages for context (optional)
// @param {string}   caption    The user's text accompanying the image (optional)
// ─────────────────────────────────────────────────────────────────────────────
async function analyzeImage(imageUrl, lang = 'en', service = 'General Support', history = [], caption = null) {
    const profile = SERVICE_PROFILES[service] || SERVICE_PROFILES['General Support'];

    const system = `You are a professional customer service assistant for Bar-Tech — a technology company.
Department: ${service}
You MUST reply in ${langLabel(lang)} only.

A customer has sent you an image. Your job is to:
1. Briefly describe what you see (1 sentence).
2. Acknowledge it in the context of a support conversation.
3. Ask what specific help they need regarding what they've shared.

Keep your response to 2–3 sentences. Be warm and professional.
Output ONLY the message text for the customer — no labels, no internal notes.`;

    // Build a vision message: attach image + any recent text context
    const userContent = [
        { type: 'image_url', image_url: { url: imageUrl, detail: 'auto' } },
        { type: 'text', text: caption || 'Please review this image and help me.' },
    ];

    // Prepend up to 5 prior text messages as context
    const contextMessages = history.slice(-5);

    logger.info(`[AI Vision] Analyzing image for service: ${service} | lang: ${lang}`);

    const completion = await openai.chat.completions.create({
        model: MODEL,
        messages: [
            { role: 'system', content: system },
            ...contextMessages,
            { role: 'user', content: userContent },
        ],
        max_tokens: 300,
        temperature: 0.4,
    });

    const reply = completion.choices[0].message.content.trim();
    logger.info(`[AI Vision] Got reply (${reply.length} chars)`);
    return reply;
}

module.exports = {
    getAIResponse,
    extractDataFromMessages,
    generateHandoffSummary,
    analyzeSentimentAndUrgency,
    analyzeImage,
};
