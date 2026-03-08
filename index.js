'use strict';
require('dotenv').config();
const express = require('express');
const { initWorker, addJob } = require('./services/queueService');
const chatwootService = require('./services/chatwootService');

const app = express();
app.use(express.json());

app.post('/webhooks/chatwoot', (req, res) => {
    if (addJob) addJob(req.body);
    res.status(200).send('OK');
});

if (initWorker) {
    initWorker(async (payload) => {
        try {
            if (payload.message_type !== 'incoming') return;
            const conversationId = payload.conversation?.id || payload.id;
            const content = payload.content;
            
            console.log(`📡 Sending to Gemini (2.5 Flash): ${content}`);

            // כאן הוספנו את ה-System Prompt
            const systemPrompt = process.env.SYSTEM_PROMPT || "אתה עוזר וירטואלי.";

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    system_instruction: { parts: [{ text: systemPrompt }] },
                    contents: [{ parts: [{ text: content }] }]
                })
            });

            const data = await response.json();
            
            if (data.error) {
                console.error('❌ Google API Error:', data.error.message);
                return;
            }

            const aiReply = data.candidates[0].content.parts[0].text;

            if (aiReply) {
                await chatwootService.sendMessage(2, conversationId, aiReply);
                console.log(`✅ Success! Sent to WhatsApp`);
            }
        } catch (err) {
            console.error('❌ System Error:', err.message);
        }
    });
}

app.listen(3100, () => console.log('🚀 DIRECT API MODE ACTIVE (With Personality)'));
