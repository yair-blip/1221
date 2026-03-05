'use strict';

require('dotenv').config();
const axios           = require('axios');
const logger          = require('./logger');
const chatwootService = require('./chatwootService');

const WA_API_VERSION = 'v20.0';

function normalizePhone(phone) {
    if (!phone) return null;
    let digits = String(phone).replace(/\D/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (!digits || digits.length < 7) return null;
    return digits;
}

async function sendWhatsAppMessage(to, message) {
    const provider = (process.env.WHATSAPP_PROVIDER || 'none').toLowerCase();

    if (provider === 'none') {
        logger.info(`[WhatsApp] Provider=none — skipping to ${to}: ${message.slice(0,40)}…`);
        return true;
    }

    const normalizedTo = normalizePhone(to);
    if (!normalizedTo) {
        logger.warn(`[WhatsApp] Invalid or empty phone number: "${to}"`);
        return false;
    }

    await new Promise(r => setTimeout(r, 1000)); // rate-limit spacing

    logger.info(`[WhatsApp] Sending via ${provider} → ${normalizedTo}`);

    try {
        if (provider === 'meta') {
            const token         = process.env.WHATSAPP_API_TOKEN;
            const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
            if (!token || !phoneNumberId) {
                logger.error('[WhatsApp] WHATSAPP_API_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set');
                return false;
            }
            await axios.post(
                `https://graph.facebook.com/${WA_API_VERSION}/${phoneNumberId}/messages`,
                {
                    messaging_product: 'whatsapp',
                    recipient_type:    'individual',
                    to:                normalizedTo,
                    type:              'text',
                    text:              { body: message, preview_url: false },
                },
                {
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    timeout: 10_000,
                }
            );

        } else if (provider === 'twilio') {
            const sid            = process.env.TWILIO_ACCOUNT_SID;
            const authToken      = process.env.TWILIO_AUTH_TOKEN;
            const twilioWaNumber = process.env.TWILIO_WHATSAPP_NUMBER;
            if (!sid || !authToken || !twilioWaNumber) {
                logger.error('[WhatsApp] Twilio credentials incomplete');
                return false;
            }
            const auth = Buffer.from(`${sid}:${authToken}`).toString('base64');
            const body = new URLSearchParams({ From: twilioWaNumber, To: `whatsapp:+${normalizedTo}`, Body: message });
            await axios.post(
                `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
                body.toString(),
                {
                    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                    timeout: 10_000,
                }
            );

        } else {
            logger.warn(`[WhatsApp] Unknown provider: ${provider}`);
            return false;
        }

        logger.info(`[WhatsApp] ✓ Sent to ${normalizedTo}`);
        return true;

    } catch (err) {
        const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        logger.error(`[WhatsApp] ✗ Failed → ${normalizedTo}: ${detail}`);
        return false;
    }
}

async function sendCallFollowUp(phoneNumber, callType) {
    const message = callType === 'missed'
        ? 'مرحباً! لاحظنا أنك اتصلت بـ Bar-Tech ولم نتمكن من الرد. كيف يمكننا مساعدتك؟ يمكنك الرد هنا مباشرة.'
        : 'شكراً لاتصالك بـ Bar-Tech! تم فتح تذكرة دعم لمتابعة طلبك. يمكنك الاستمرار في التواصل معنا هنا.';
    return sendWhatsAppMessage(phoneNumber, message);
}

async function notifyTicketEvent(contactId, conversationId, type) {
    if (!contactId) {
        logger.warn(`[WhatsApp] notifyTicketEvent: null contactId for conv ${conversationId}`);
        return;
    }
    try {
        const contact = await chatwootService.findContactById(contactId);
        if (!contact?.phone_number) {
            logger.warn(`[WhatsApp] Contact ${contactId} has no phone — skipping notification`);
            return;
        }
        let message = '';
        if (type === 'opened') {
            message = `مرحباً! تم فتح تذكرة الدعم رقم #${conversationId} في Bar-Tech. وكيلنا الذكي يعمل على معالجة طلبك الآن.`;
        } else if (type === 'closed') {
            message = `تم حل تذكرتك رقم #${conversationId} وإغلاقها في Bar-Tech. شكراً لتواصلك معنا!`;
        }
        if (message) await sendWhatsAppMessage(contact.phone_number, message);
    } catch (err) {
        logger.error(`[WhatsApp] notifyTicketEvent error: ${err.message}`);
    }
}

module.exports = { sendWhatsAppMessage, sendCallFollowUp, notifyTicketEvent, normalizePhone };
