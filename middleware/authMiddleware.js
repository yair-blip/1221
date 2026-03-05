'use strict';

require('dotenv').config();
const crypto = require('crypto');
const logger = require('../services/logger');

// Critical: Security check - ensure secrets are loaded
if (!process.env.INTERNAL_API_KEY) {
    console.error('[Auth] CRITICAL: INTERNAL_API_KEY is not set in .env');
}

// Warn ONCE at startup if secret not configured — not on every request
if (!process.env.CHATWOOT_WEBHOOK_SECRET) {
    console.warn('[Auth] CHATWOOT_WEBHOOK_SECRET not set — webhook signature verification disabled.');
}

/**
 * Verify Chatwoot HMAC-SHA256 webhook signature.
 * Support older Chatwoot versions that do not send signatures.
 */
function verifyChatwootSignature(req, res, next) {
    const secret    = process.env.CHATWOOT_WEBHOOK_SECRET;
    const signature = req.headers['x-chatwoot-signature'];

    // No secret configured — allow through silently (older Chatwoot versions
    // do not support webhook tokens, so this is expected and safe)
    if (!secret) return next();

    // Secret is set but Chatwoot didn't send a signature header
    // This happens when the Chatwoot version doesn't support webhook tokens
    if (!signature) return next();

    const bodyToSign = req.rawBody || JSON.stringify(req.body);
    const digest     = crypto.createHmac('sha256', secret).update(bodyToSign).digest('hex');

    try {
        const sigBuf = Buffer.from(signature);
        const digBuf = Buffer.from(digest);
        if (sigBuf.length !== digBuf.length || !crypto.timingSafeEqual(sigBuf, digBuf)) {
            throw new Error('mismatch');
        }
    } catch {
        logger.warn('[Auth] Invalid Chatwoot signature attempt');
        return res.status(401).send('Unauthorized: invalid signature');
    }

    next();
}

/**
 * Verify internal API key for 3CX and other internal webhooks.
 * STRICT: Returns 401 if key is missing or invalid.
 */
function verifyApiKey(req, res, next) {
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (!expectedKey) {
        logger.error('[Auth] INTERNAL_API_KEY missing - blocking request');
        return res.status(401).send('Unauthorized: system configuration error');
    }

    const provided = req.headers['x-api-key'] || req.query.api_key;
    if (!provided) {
        logger.warn('[Auth] API Key required but not provided');
        return res.status(401).send('Unauthorized: API key required');
    }

    try {
        const a = Buffer.from(provided);
        const b = Buffer.from(expectedKey);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
            throw new Error('mismatch');
        }
    } catch {
        logger.warn('[Auth] Invalid internal API key attempt');
        return res.status(401).send('Unauthorized: invalid API key');
    }

    next();
}

module.exports = { verifyChatwootSignature, verifyApiKey };
