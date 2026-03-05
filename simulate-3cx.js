#!/usr/bin/env node
'use strict';
/**
 * simulate-3cx.js
 * Sends a fake 3CX call webhook to test the call flow locally.
 *
 * Usage:
 *   node simulate-3cx.js                              → missed call, Support
 *   node simulate-3cx.js handled Sales                → handled, Sales dept
 *   node simulate-3cx.js missed Fleet +97250000000    → missed, Fleet dept
 */
require('dotenv').config();
const axios = require('axios');

const [,, callStatus = 'missed', department = 'Support', phone = '+972509999999'] = process.argv;

async function run() {
    const url    = `http://localhost:${process.env.PORT || 3000}/webhooks/3cx`;
    const apiKey = process.env.INTERNAL_API_KEY || 'change_this_key';
    const body   = { phoneNumber: phone, callStatus, department, customerName: 'Test Customer', did: '03-1234567', dn: '101' };

    console.log(`\n[Simulator] ${callStatus.toUpperCase()} call | ${phone} → ${department}`);
    console.log('[Simulator] Payload:', JSON.stringify(body, null, 2));

    try {
        const res = await axios.post(url, body, {
            headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
            timeout: 15_000,
        });
        console.log('[Simulator] ✓ Response:', JSON.stringify(res.data, null, 2));
    } catch (err) {
        const detail = err.response ? `${err.response.status} ${JSON.stringify(err.response.data)}` : err.message;
        console.error('[Simulator] ✗', detail);
    }
}
run();
