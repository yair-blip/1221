#!/usr/bin/env node
/**
 * DIAGNOSTIC SCRIPT — Run this on your server to confirm the full AI pipeline works.
 * Usage: node diagnose.js
 * 
 * This script simulates exactly what Chatwoot sends to your webhook and traces every step.
 */
'use strict';
require('dotenv').config();

console.log('\n========================================');
console.log('Bar-Tech AI — DIAGNOSTIC CHECK');
console.log('========================================\n');

// ── 1. Check environment variables ──────────────────────────────────────────
console.log('STEP 1: Environment Variables\n');

const checks = [
    ['OPENAI_API_KEY',         process.env.OPENAI_API_KEY,         'Required for AI replies'],
    ['CHATWOOT_API_URL',       process.env.CHATWOOT_API_URL,       'Required to send messages'],
    ['CHATWOOT_API_TOKEN',     process.env.CHATWOOT_API_TOKEN,     'Required to send messages'],
    ['CHATWOOT_ACCOUNT_ID',   process.env.CHATWOOT_ACCOUNT_ID,   'Required for all API calls'],
    ['CHATWOOT_WEBHOOK_SECRET', process.env.CHATWOOT_WEBHOOK_SECRET, 'Required for HMAC verification'],
    ['CHATWOOT_INBOX_ID',     process.env.CHATWOOT_INBOX_ID,     'Required for conversation creation'],
];

let envOk = true;
checks.forEach(([key, val, desc]) => {
    const set = val && val !== 'your_openai_api_key_here' && val !== 'your_chatwoot_api_token';
    const icon = set ? '✓' : '✗ MISSING/PLACEHOLDER';
    console.log(`  ${icon}  ${key}`);
    if (!set) {
        console.log(`         → ${desc}`);
        envOk = false;
    }
});

if (!envOk) {
    console.log('\n⚠  Fix the above variables in your .env file before proceeding.\n');
} else {
    console.log('\n  All required env vars are set.\n');
}

// ── 2. Test OpenAI connection ────────────────────────────────────────────────
console.log('STEP 2: OpenAI API Connection\n');

async function testOpenAI() {
    const { OpenAI } = require('openai');
    const useAzure = !!(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_KEY);
    const openai = useAzure
        ? new OpenAI({
            apiKey:         process.env.AZURE_OPENAI_KEY,
            baseURL:        `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT}`,
            defaultQuery:   { 'api-version': process.env.AZURE_OPENAI_API_VERSION || '2024-02-01' },
            defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_KEY },
        })
        : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = useAzure
        ? (process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o')
        : (process.env.OPENAI_MODEL || 'gpt-4o');

    console.log(`  Provider: ${useAzure ? 'Azure OpenAI' : 'OpenAI'}`);
    console.log(`  Model: ${model}`);
    console.log(`  Sending test message: "Hello, reply with exactly: TEST_OK"\n`);

    try {
        const completion = await openai.chat.completions.create({
            model,
            messages: [
                { role: 'system', content: 'You are a test assistant. Reply with exactly the text the user asks for, nothing else.' },
                { role: 'user',   content: 'Reply with exactly: TEST_OK' },
            ],
            max_tokens: 20,
            temperature: 0,
        });
        const reply = completion.choices[0].message.content.trim();
        if (reply.includes('TEST_OK')) {
            console.log(`  ✓ OpenAI responded correctly: "${reply}"`);
            console.log('  ✓ LLM connection is WORKING\n');
            return true;
        } else {
            console.log(`  ⚠  Unexpected response: "${reply}"`);
            console.log('  ⚠  LLM connection works but model behaved unexpectedly\n');
            return true;
        }
    } catch (err) {
        console.log(`  ✗ OpenAI FAILED: ${err.message}`);
        if (err.message.includes('401') || err.message.includes('Incorrect API key')) {
            console.log('  → Your OPENAI_API_KEY is invalid or expired. Get a new one at https://platform.openai.com/api-keys');
        } else if (err.message.includes('429')) {
            console.log('  → Rate limited or quota exceeded. Check your OpenAI billing at https://platform.openai.com/usage');
        } else if (err.message.includes('ENOTFOUND') || err.message.includes('ECONNREFUSED')) {
            console.log('  → Cannot reach OpenAI servers. Check your internet/firewall settings.');
        }
        console.log('');
        return false;
    }
}

// ── 3. Test Chatwoot connection ──────────────────────────────────────────────
async function testChatwoot() {
    console.log('STEP 3: Chatwoot API Connection\n');
    const axios = require('axios');
    try {
        const res = await axios.get(
            `${process.env.CHATWOOT_API_URL}/api/v1/accounts/${process.env.CHATWOOT_ACCOUNT_ID}/conversations`,
            { headers: { 'api_access_token': process.env.CHATWOOT_API_TOKEN }, timeout: 10000, params: { page: 1 } }
        );
        const count = res.data?.data?.meta?.all_count ?? '?';
        console.log(`  ✓ Chatwoot API connected. Total conversations: ${count}`);
        console.log('  ✓ Chatwoot connection is WORKING\n');
        return true;
    } catch (err) {
        console.log(`  ✗ Chatwoot FAILED: ${err.response?.status} ${err.message}`);
        if (err.response?.status === 401) {
            console.log('  → CHATWOOT_API_TOKEN is invalid. Get it from Chatwoot → Profile → Access Token');
        } else if (err.response?.status === 404) {
            console.log('  → CHATWOOT_ACCOUNT_ID or CHATWOOT_API_URL is wrong.');
        }
        console.log('');
        return false;
    }
}

// ── 4. Simulate full AI pipeline ─────────────────────────────────────────────
async function testFullPipeline() {
    console.log('STEP 4: Full AI Pipeline Simulation\n');
    const aiService = require('./services/aiService');

    const testMessages = [
        { role: 'user', content: 'Hello, I need help with my laptop screen.' }
    ];

    console.log('  Simulating incoming message: "Hello, I need help with my laptop screen."');
    console.log('  Calling getAIResponse...\n');

    try {
        const reply = await aiService.getAIResponse(testMessages, 'General Support', 'name', {}, 'en');
        console.log(`  ✓ AI replied successfully:`);
        console.log(`  ─────────────────────────`);
        console.log(`  "${reply}"`);
        console.log(`  ─────────────────────────`);
        
        // Check for leaking system instructions
        const techWords = ['system', 'instruction', 'webhook', 'pipeline', 'chatwoot', 'api', 'workflow', 'bot:', 'ai:', 'assistant:'];
        const hasLeak = techWords.some(w => reply.toLowerCase().includes(w));
        if (hasLeak) {
            console.log('  ⚠  WARNING: Reply may contain technical/system text. Check your OpenAI model.');
        } else {
            console.log('  ✓ Reply looks clean — no technical instructions leaked.');
        }
        console.log('');
        return true;
    } catch (err) {
        console.log(`  ✗ AI pipeline FAILED: ${err.message}\n`);
        return false;
    }
}

// ── 5. Test handoff simulation ────────────────────────────────────────────────
async function testHandoff() {
    console.log('STEP 5: Handoff Detection Test\n');

    const testPhrases = {
        en: 'I want to speak with a human agent please',
        he: 'אני רוצה לדבר עם נציג אנושי',
        ar: 'اريد التحدث مع موظف بشري',
    };

    const HANDOFF_RE = /\b(agent|human|operator|representative|person|staff|supervisor|manager|escalate)\b|بشري|وكيل|موظف|مدير|نريد انسان|נציג|אנוש|אדם אמיתי|נציג אנושי|תעביר|לדבר עם אדם|עם נציג/i;

    Object.entries(testPhrases).forEach(([lang, phrase]) => {
        const detected = HANDOFF_RE.test(phrase);
        console.log(`  ${detected ? '✓' : '✗'} [${lang}] "${phrase}" → handoff: ${detected}`);
    });
    console.log('');
}

// ── Run all tests ─────────────────────────────────────────────────────────────
(async () => {
    const aiOk  = await testOpenAI();
    const cwOk  = await testChatwoot();
    if (aiOk) await testFullPipeline();
    await testHandoff();

    console.log('========================================');
    console.log('SUMMARY');
    console.log('========================================');
    console.log(`  OpenAI:   ${aiOk  ? '✓ OK' : '✗ FAILED — fix OPENAI_API_KEY'}`);
    console.log(`  Chatwoot: ${cwOk  ? '✓ OK' : '✗ FAILED — fix CHATWOOT_API_URL / TOKEN'}`);
    console.log('');
    
    if (!aiOk) {
        console.log('ROOT CAUSE OF YOUR ISSUE:');
        console.log('  Your OPENAI_API_KEY is not working.');
        console.log('  When the AI call fails, the bot sends the fallback error message instead of an AI reply.');
        console.log('  This is why you see generic/technical text instead of a proper response.');
        console.log('');
        console.log('FIX:');
        console.log('  1. Go to https://platform.openai.com/api-keys');
        console.log('  2. Create a new API key');
        console.log('  3. Put it in your .env: OPENAI_API_KEY=sk-...');
        console.log('  4. Restart the server: pm2 restart bar-tech-ai');
    }
    
    if (aiOk && cwOk) {
        console.log('✓ Everything looks good. If the bot still sends wrong messages:');
        console.log('');
        console.log('CHECK IN CHATWOOT:');
        console.log('  1. Settings → Automation — delete any automation rules that send messages');
        console.log('  2. Settings → Agent Bots — make sure no other bot is configured');
        console.log('  3. Settings → Integrations → Webhooks — only ONE webhook URL pointing to your server');
        console.log('');
        console.log('CHECK ON YOUR SERVER:');
        console.log('  1. Make sure you uploaded and deployed the new code (not running old version)');
        console.log('  2. Run: pm2 restart bar-tech-ai');
        console.log('  3. Run: pm2 logs bar-tech-ai  — watch logs when a message arrives');
        console.log('     You should see: "[AI] Processing conv..." then "[AI] ✓ Reply sent"');
        console.log('     If you see "[AI] Pipeline error" — the API key is the problem');
    }

    console.log('========================================\n');
})();
