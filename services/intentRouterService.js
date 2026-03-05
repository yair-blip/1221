'use strict';

/**
 * intentRouterService.js
 * ────────────────────────────────────────────────────────────────────────────
 * Classifies incoming messages and routes conversations between:
 *   Group A — General  (Sales, Service, Admin)
 *   Group B — Technical Support
 *
 * Uses OpenAI to classify intent, then updates Chatwoot inbox/assignee
 * accordingly.  All routing decisions are logged as private notes so
 * agents can see the AI's reasoning.
 * ────────────────────────────────────────────────────────────────────────────
 */

const { OpenAI }      = require('openai');
const chatwootService = require('./chatwootService');
const logger          = require('./logger');

// ── OpenAI client (same as aiService — re-uses env vars) ─────────────────────
const useAzure = !!(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_KEY);
const openai   = useAzure
    ? new OpenAI({
        apiKey:         process.env.AZURE_OPENAI_KEY,
        baseURL:        `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT}`,
        defaultQuery:   { 'api-version': process.env.AZURE_OPENAI_API_VERSION || '2024-02-01' },
        defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_KEY },
    })
    : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL = useAzure
    ? (process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o')
    : (process.env.OPENAI_MODEL            || 'gpt-4o');

// ── Intent categories ─────────────────────────────────────────────────────────
const INTENTS = {
    TECHNICAL:  'technical',
    SALES:      'sales',
    GENERAL:    'general',
    COMPLAINT:  'complaint',
    HANDOFF:    'handoff',    // explicit human request
};

// ── Chatwoot Inbox IDs loaded from env ────────────────────────────────────────
const INBOX_GROUP_B_SUPPORT = () => process.env.CHATWOOT_SUPPORT_INBOX_ID || process.env.CHATWOOT_INBOX_ID;
const INBOX_GROUP_A_SALES   = () => process.env.CHATWOOT_SALES_INBOX_ID   || process.env.CHATWOOT_INBOX_ID;

// ── Keywords for fast (no-LLM) pre-classification ────────────────────────────
const TECHNICAL_KEYWORDS = [
    /\b(bug|error|crash|broken|not working|issue|problem|failure|glitch|down|offline|disconnected)\b/i,
    /\b(ticket|support|technical|tech|IT|network|server|software|hardware|install|setup|config)\b/i,
    /\b(בעיה|תקלה|תמיכה|טכני|שגיאה|נפל|לא עובד|קריסה|ניתוק|הגדרות)/,      // Hebrew
    /\b(مشكلة|عطل|دعم|تقني|خطأ|لا يعمل|انقطاع|إعداد)/,                      // Arabic
];

const SALES_KEYWORDS = [
    /\b(price|pricing|quote|offer|buy|purchase|order|plan|package|cost|demo|trial)\b/i,
    /\b(מחיר|הצעה|רכישה|קנייה|הזמנה|חבילה|עלות|דמו)/,
    /\b(سعر|عرض|شراء|اشتراك|باقة|تكلفة|تجربة)/,
];

const HANDOFF_KEYWORDS = [
    /\b(human|agent|person|representative|speak to|talk to|call me)\b/i,
    /\b(נציג|אדם|לדבר עם|מנהל|להעביר)/,
    /\b(موظف|إنسان|شخص|مسؤول|تحدث مع)/,
];

/**
 * Fast keyword pre-check before burning an LLM call.
 * Returns an intent string or null (needs LLM classification).
 */
function quickClassify(text) {
    if (!text) return INTENTS.GENERAL;
    if (HANDOFF_KEYWORDS.some(re => re.test(text))) return INTENTS.HANDOFF;
    if (TECHNICAL_KEYWORDS.some(re => re.test(text))) return INTENTS.TECHNICAL;
    if (SALES_KEYWORDS.some(re => re.test(text))) return INTENTS.SALES;
    return null; // needs LLM
}

/**
 * LLM-based intent classification.
 * Returns one of: technical | sales | general | complaint | handoff
 */
async function classifyIntent(conversationHistory = [], latestMessage = '') {
    // Try fast path first
    const quick = quickClassify(latestMessage);
    if (quick) {
        logger.info(`[Router] Quick-classified as "${quick}"`);
        return quick;
    }

    try {
        const messages = conversationHistory.slice(-10); // keep it cheap
        const system = `You are an intent classifier for a B2B technology company's customer service system.
Analyze the conversation and classify the customer's PRIMARY intent into EXACTLY ONE category:
- "technical"  — technical support, bugs, errors, troubleshooting, setup help
- "sales"       — pricing, quotes, purchasing, product demos, new accounts
- "complaint"   — general complaints about service quality (not technical)
- "handoff"     — customer explicitly asking for a human agent
- "general"     — everything else (greetings, general inquiries)

Reply with ONLY the single category word, nothing else.`;

        const res = await openai.chat.completions.create({
            model:       MODEL,
            messages:    [{ role: 'system', content: system }, ...messages, { role: 'user', content: latestMessage }],
            max_tokens:  5,
            temperature: 0,
        });

        const intent = res.choices[0].message.content.trim().toLowerCase();
        logger.info(`[Router] LLM classified intent as "${intent}"`);
        return Object.values(INTENTS).includes(intent) ? intent : INTENTS.GENERAL;
    } catch (err) {
        logger.error(`[Router] Intent classification failed: ${err.message}`);
        return INTENTS.GENERAL;
    }
}

/**
 * routeToTechnicalSupport
 * Moves a conversation from Group A to Group B (Technical Support inbox).
 * Posts a private note explaining why.
 */
async function routeToTechnicalSupport(accountId, conversationId, reason = '') {
    const targetInbox = INBOX_GROUP_B_SUPPORT();
    if (!targetInbox) {
        logger.warn('[Router] CHATWOOT_SUPPORT_INBOX_ID not set — cannot route to Group B');
        return false;
    }

    try {
        // Re-assign to support inbox
        await chatwootService.updateConversation(accountId, conversationId, {
            inbox_id: parseInt(targetInbox, 10),
        });

        // Assign to default support agent if configured
        const agentId = process.env.DEFAULT_SUPPORT_AGENT_ID || process.env.DEFAULT_ASSIGNEE_ID;
        if (agentId) {
            await chatwootService.updateConversation(accountId, conversationId, {
                assignee_id: parseInt(agentId, 10),
            });
        }

        // Leave a private note so agents see the routing decision
        const note = `🤖 *Auto-routed to Technical Support*\nReason: ${reason || 'Technical intent detected'}\nRouted by: Bar-Tech AI`;
        await chatwootService.sendPrivateNote(accountId, conversationId, note);

        logger.info(`[Router] Conv ${conversationId} routed to Technical Support (inbox ${targetInbox})`);
        return true;
    } catch (err) {
        logger.error(`[Router] Failed to route conv ${conversationId}: ${err.message}`);
        return false;
    }
}

/**
 * routeToSales
 * Moves a conversation to the Sales inbox (still Group A).
 */
async function routeToSales(accountId, conversationId) {
    const targetInbox = INBOX_GROUP_A_SALES();
    if (!targetInbox) return false;
    try {
        await chatwootService.updateConversation(accountId, conversationId, {
            inbox_id: parseInt(targetInbox, 10),
        });
        const agentId = process.env.DEFAULT_SALES_AGENT_ID;
        if (agentId) {
            await chatwootService.updateConversation(accountId, conversationId, {
                assignee_id: parseInt(agentId, 10),
            });
        }
        await chatwootService.sendPrivateNote(accountId, conversationId, '🤖 *Auto-routed to Sales*\nIntent: Sales inquiry detected by AI');
        logger.info(`[Router] Conv ${conversationId} routed to Sales`);
        return true;
    } catch (err) {
        logger.error(`[Router] Sales route failed: ${err.message}`);
        return false;
    }
}

/**
 * evaluateAndRoute
 * The main entry point called by webhooks.js on every incoming message
 * (for Group A channels).
 *
 * @param {string} accountId
 * @param {string} conversationId
 * @param {Array}  conversationHistory  - array of {role, content} messages
 * @param {string} latestMessage        - the raw text of the latest message
 * @param {string} currentGroup         - 'A' or 'B'
 * @returns {Promise<{intent, routed, targetGroup}>}
 */
async function evaluateAndRoute(accountId, conversationId, conversationHistory, latestMessage, currentGroup = 'A') {
    const intent = await classifyIntent(conversationHistory, latestMessage);

    let routed      = false;
    let targetGroup = currentGroup;

    if (intent === INTENTS.TECHNICAL && currentGroup === 'A') {
        routed      = await routeToTechnicalSupport(accountId, conversationId, 'Customer has a technical issue');
        targetGroup = routed ? 'B' : 'A';
    } else if (intent === INTENTS.SALES && currentGroup === 'A') {
        routed      = await routeToSales(accountId, conversationId);
        targetGroup = 'A'; // stays in Group A, just different agent
    }

    return { intent, routed, targetGroup };
}

module.exports = {
    classifyIntent,
    evaluateAndRoute,
    routeToTechnicalSupport,
    routeToSales,
    INTENTS,
};
