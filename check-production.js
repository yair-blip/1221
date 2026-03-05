#!/usr/bin/env node
'use strict';

require('dotenv').config();
const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const G = '\x1b[32m✓\x1b[0m';
const R = '\x1b[31m✗\x1b[0m';
const W = '\x1b[33m⚠\x1b[0m';

let blockers  = 0;
let warnings  = 0;

function pass(msg)  { console.log(`  ${G}  ${msg}`); }
function fail(msg)  { console.log(`  ${R}  ${msg}`); blockers++; }
function warn(msg)  { console.log(`  ${W}  ${msg}`); warnings++; }

function checkEnv(name, level = 'critical') {
    const val = process.env[name];
    if (!val || val.includes('your_') || val.trim() === '') {
        level === 'critical' ? fail(`${name} is not set`) : warn(`${name} is not set`);
        return false;
    }
    pass(`${name} configured`);
    return true;
}

async function run() {
    console.log('\n\x1b[36m══════════════════════════════════════════════\x1b[0m');
    console.log('\x1b[36m   Bar-Tech AI — Production Readiness Check\x1b[0m');
    console.log('\x1b[36m══════════════════════════════════════════════\x1b[0m\n');

    // 1. Critical env vars
    console.log('── Core Configuration ───────────────────────');
    checkEnv('OPENAI_API_KEY');
    checkEnv('CHATWOOT_API_URL');
    checkEnv('CHATWOOT_API_TOKEN');
    checkEnv('CHATWOOT_ACCOUNT_ID');
    checkEnv('CHATWOOT_INBOX_ID');
    checkEnv('CHATWOOT_WEBHOOK_SECRET');
    checkEnv('INTERNAL_API_KEY');

    // 2. WhatsApp
    console.log('\n── WhatsApp ─────────────────────────────────');
    const waProvider = process.env.WHATSAPP_PROVIDER;
    if (waProvider === 'meta') {
        checkEnv('WHATSAPP_API_TOKEN');
        checkEnv('WHATSAPP_PHONE_NUMBER_ID');
        checkEnv('WHATSAPP_VERIFY_TOKEN', 'warning');
    } else if (waProvider === 'twilio') {
        checkEnv('TWILIO_ACCOUNT_SID');
        checkEnv('TWILIO_AUTH_TOKEN');
        checkEnv('TWILIO_WHATSAPP_NUMBER');
    } else if (waProvider === 'none') {
        warn('WHATSAPP_PROVIDER=none — WhatsApp messages will be skipped');
    } else {
        fail('WHATSAPP_PROVIDER must be "meta", "twilio", or "none"');
    }

    // 3. Email
    console.log('\n── Email ────────────────────────────────────');
    checkEnv('EMAIL_USER', 'warning');
    checkEnv('EMAIL_PASS', 'warning');
    if (!process.env.EMAIL_IMAP_HOST) {
        warn('EMAIL_IMAP_HOST not set — IMAP polling will be disabled');
    } else {
        pass('EMAIL_IMAP_HOST configured');
    }

    // 4. Database
    console.log('\n── Database ─────────────────────────────────');
    const dbPath = path.resolve(__dirname, 'data/mvp.db');
    const dataDir = path.resolve(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        try { fs.mkdirSync(dataDir); pass('data/ directory created'); }
        catch { fail('Could not create data/ directory'); }
    } else {
        pass('data/ directory exists');
    }
    if (fs.existsSync(dbPath)) pass('mvp.db exists');
    else warn('mvp.db not found — will be created on first run');

    // 5. Logs directory
    console.log('\n── Logging ──────────────────────────────────');
    const logsDir = path.resolve(__dirname, 'logs');
    if (!fs.existsSync(logsDir)) {
        try { fs.mkdirSync(logsDir); pass('logs/ directory created'); }
        catch { fail('Could not create logs/ directory'); }
    } else {
        pass('logs/ directory exists');
    }

    // 6. Chatwoot API connectivity
    console.log('\n── API Connectivity ─────────────────────────');
    if (process.env.CHATWOOT_API_URL && process.env.CHATWOOT_API_TOKEN) {
        try {
            await axios.get(`${process.env.CHATWOOT_API_URL}/api/v1/profile`, {
                headers:  { api_access_token: process.env.CHATWOOT_API_TOKEN },
                timeout:  8000,
            });
            pass('Chatwoot API reachable and token valid');
        } catch (e) {
            fail(`Chatwoot API unreachable or token invalid (${e.response?.status || e.message})`);
        }
    }

    // 7. OpenAI connectivity
    if (process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes('your_')) {
        try {
            await axios.get('https://api.openai.com/v1/models', {
                headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
                timeout: 8000,
            });
            pass('OpenAI API key valid');
        } catch (e) {
            if (e.response?.status === 401) fail('OpenAI API key is INVALID');
            else pass('OpenAI API reachable (non-401 response)');
        }
    }

    // ── Result ────────────────────────────────────────────────────────────────
    console.log('\n\x1b[36m══════════════════════════════════════════════\x1b[0m');
    if (blockers > 0) {
        console.log(`\x1b[31m RESULT: NOT READY — ${blockers} blocker(s), ${warnings} warning(s)\x1b[0m`);
        console.log('\x1b[31m Fix all ✗ items before deploying.\x1b[0m\n');
        process.exit(1);
    } else if (warnings > 0) {
        console.log(`\x1b[33m RESULT: READY WITH WARNINGS — ${warnings} warning(s)\x1b[0m`);
        console.log('\x1b[33m Review ⚠ items before going live.\x1b[0m\n');
    } else {
        console.log('\x1b[32m RESULT: READY FOR PRODUCTION ✓\x1b[0m\n');
    }
}

run().catch(err => {
    console.error('Check script failed:', err.message);
    process.exit(1);
});
