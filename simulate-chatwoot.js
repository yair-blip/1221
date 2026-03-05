#!/usr/bin/env node
'use strict';
/**
 * simulate-chatwoot.js
 * Sends a correctly signed Chatwoot webhook to your running server.
 * Sends message_type as INTEGER (0=incoming) matching real Chatwoot behavior.
 *
 * Usage:
 *   node simulate-chatwoot.js "Hello I need help"
 *   node simulate-chatwoot.js "I want a human agent" 999
 *   node simulate-chatwoot.js "אני רוצה נציג" 123
 *   node simulate-chatwoot.js "اريد مساعدة" 123
 */
require('dotenv').config();
const axios  = require('axios');
const crypto = require('crypto');

const [,, message = 'Hello, I need support with my device.', convId = '12345', eventType = 'message_created'] = process.argv;

const secret    = process.env.CHATWOOT_WEBHOOK_SECRET || 'test-secret';
const port      = process.env.PORT || 3000;
const accountId = parseInt(process.env.CHATWOOT_ACCOUNT_ID, 10) || 2;
const inboxId   = parseInt(process.env.CHATWOOT_INBOX_ID, 10)   || 5;

// IMPORTANT: Real Chatwoot sends message_type as INTEGER not string
// 0 = incoming (customer), 1 = outgoing (agent/bot), 2 = activity
const payload = {
    event:        eventType,
    id:           Math.floor(Math.random() * 99999),
    content:      message,
    message_type: eventType === 'message_created' ? 0 : undefined, // ← INTEGER 0 not 'incoming'
    created_at:   new Date().toISOString(),
    account: { id: accountId, name: 'Bar-Tech' },
    conversation: {
        id:       parseInt(convId, 10),
        status:   'open',
        inbox_id: inboxId,
        inbox:    { id: inboxId, name: 'General Support' },
        meta: {
            sender: {
                id:           42,
                name:         'Test Customer',
                phone_number: '+972509999999',
                type:         'contact',
            },
        },
    },
    inbox:  { id: inboxId, name: 'General Support' },
    sender: { id: 42, name: 'Test Customer', type: 'contact' },
    meta:   { sender: { id: 42, name: 'Test Customer', phone_number: '+972509999999' } },
};

const bodyStr   = JSON.stringify(payload);
const signature = crypto.createHmac('sha256', secret).update(bodyStr).digest('hex');

async function run() {
    console.log('\n[Simulator] ─────────────────────────────────');
    console.log(`[Simulator] Event:   ${eventType}`);
    console.log(`[Simulator] Conv ID: ${convId}`);
    console.log(`[Simulator] Message: "${message}"`);
    console.log(`[Simulator] URL:     http://localhost:${port}/webhooks/chatwoot`);
    console.log('[Simulator] ─────────────────────────────────\n');

    try {
        const res = await axios.post(
            `http://localhost:${port}/webhooks/chatwoot`,
            payload,
            {
                headers: {
                    'Content-Type':         'application/json',
                    'x-chatwoot-signature': signature,
                },
                timeout: 30_000,
            }
        );
        console.log(`[Simulator] ✓ Server responded: ${res.status} ${res.data}`);
        console.log('[Simulator] Now check:');
        console.log('  1. Your server logs (pm2 logs bar-tech-ai) for [AI] lines');
        console.log('  2. Your Chatwoot conversation for the bot reply');
        if (/agent|human|נציג|موظف|אנוש/i.test(message)) {
            console.log('  3. Conversation status should change to "Pending"');
            console.log('  4. A private internal note should appear for agents');
        }
    } catch (err) {
        const detail = err.response
            ? `HTTP ${err.response.status} — ${JSON.stringify(err.response.data)}`
            : err.message;
        console.error(`[Simulator] ✗ Request failed: ${detail}`);
        if (err.code === 'ECONNREFUSED') {
            console.error('[Simulator] → Server is not running. Start it with: node index.js or pm2 start ecosystem.config.js');
        }
    }
}

run();
