const express = require('express');
const router = express.Router();
const aiService = require('../services/aiService');
const chatwootService = require('../services/chatwootService');
const dbService = require('../services/dbService');
const businessHoursService = require('../services/businessHoursService');
const configService = require('../services/configService');
const logger = require('../services/logger');

const recentlySent = new Set();
function markBotSent(convId) {
    recentlySent.add(String(convId));
    setTimeout(() => recentlySent.delete(String(convId)), 10000);
}
function botJustSent(convId) {
    return recentlySent.has(String(convId));
}

function detectLanguage(text) {
    const t = text || '';
    const he = (t.match(/[\u05D0-\u05EA]/g) || []).length;
    return he > 0 ? 'he' : 'en';
}

router.post('/chatwoot', async (req, res) => {
    res.status(200).send('OK');
    const event = req.body;
    if (!event || event.event !== 'message_created') return;

    const conversationId = event.conversation?.id || event.conversation_id;
    const accountId = event.account?.id || event.account_id;
    const content = (event.content || '').trim();
    const isIncoming = event.message_type === 0 || event.message_type === 'incoming';

    if (!isIncoming || !content || botJustSent(conversationId)) return;

    try {
        const lang = detectLanguage(content);
        const history = await chatwootService.getConversationMessages(accountId, conversationId);
        
        // סינון הודעות פרטיות ופעילויות
        const messages = history.filter(m => m.content && m.private !== true).map(m => ({
            role: (m.message_type === 0 || m.message_type === 'incoming') ? 'user' : 'assistant',
            content: m.content.trim(),
        }));

        if (messages.length === 0) messages.push({ role: 'user', content });

        // זיהוי אם הלקוח ביקש נציג או שה-AI חושב שצריך נציג
        const HANDOFF_RE = /נציג|אנוש|סוכן|אדם|תעביר|agent|human/i;
        const manualHandoff = HANDOFF_RE.test(content);
        
        let analysis = { shouldHandoff: false };
        try { analysis = await aiService.analyzeSentimentAndUrgency(messages); } catch (_) {}

        if (manualHandoff || analysis.shouldHandoff) {
            markBotSent(conversationId);
            
            // בדיקה: האם המשרד סגור עכשיו?
            if (!businessHoursService.isBusinessHours()) {
                const closingMsg = businessHoursService.getOutOfHoursMessage(lang);
                await chatwootService.sendMessage(accountId, conversationId, closingMsg, 'outgoing');
            } else {
                await chatwootService.sendMessage(accountId, conversationId, "מעביר אותך לנציג אנושי ברגע זה...", 'outgoing');
            }

            // העברת השיחה לנציג (סטטוס פתוח) בכל מקרה
            await chatwootService.updateConversation(accountId, conversationId, { status: 'open' });
            
            // יצירת סיכום AI עבור הנציג שיראה בבוקר
            let summary = 'Review history.';
            try { summary = await aiService.generateHandoffSummary(messages); } catch (_) {}
            const note = `📋 סיכום AI\nשפה: ${lang}\nסיכום: ${summary}`;
            await chatwootService.sendPrivateNote(accountId, conversationId, note);
            return;
        }

        // אם המשרד סגור אבל עוד לא אספנו הכל - ה-AI ממשיך לדבר
        const profile = configService.SERVICE_PROFILES['General Support'] || { requiredFields: [] };
        const aiReply = await aiService.getAIResponse(messages, "General", null, {}, lang);
        
        markBotSent(conversationId);
        await chatwootService.sendMessage(accountId, conversationId, aiReply, 'outgoing');

    } catch (err) {
        logger.error('[Webhook Error]', { error: err.message });
    }
});

module.exports = { router };
