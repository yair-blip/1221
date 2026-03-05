'use strict';

/**
 * lifecycleService.js
 * ────────────────────────────────────────────────────────────────────────────
 * Sends automated notifications to customers at key ticket lifecycle events:
 *   • Ticket OPENED  — immediate confirmation with ticket ID
 *   • Ticket RESOLVED — closure notification asking for feedback
 *
 * Delivery channels: WhatsApp (primary) + Email (if available)
 * ────────────────────────────────────────────────────────────────────────────
 */

const whatsappService = require('./whatsappService');
const emailService = require('./emailService');
const logger = require('./logger');

// ── Message templates ─────────────────────────────────────────────────────────

const TEMPLATES = {
    opened: {
        en: (id, name) =>
            `Hello${name ? ' ' + name : ''}! 👋

Your support ticket has been opened successfully.
🎫 Ticket ID: *#${id}*

Our team has received your request and will be with you shortly. You can reply to this message at any time with updates.

— Bar-Tech Support Team`,
        he: (id, name) =>
            `שלום${name ? ' ' + name : ''}! 👋

פנייתך נפתחה בהצלחה.
🎫 מספר פנייה: *#${id}*

הצוות שלנו קיבל את בקשתך ויחזור אליך בהקדם. תוכל/י להשיב להודעה זו בכל עת עם עדכונים.

— צוות התמיכה של Bar-Tech`,
        ar: (id, name) =>
            `مرحباً${name ? ' ' + name : ''}! 👋

تم فتح طلب الدعم الخاص بك بنجاح.
🎫 رقم التذكرة: *#${id}*

تلقّى فريقنا طلبك وسيتواصل معك قريباً. يمكنك الرد على هذه الرسالة في أي وقت لإضافة تحديثات.

— فريق دعم Bar-Tech`,
    },
    resolved: {
        en: (id, name) =>
            `Hello${name ? ' ' + name : ''}! ✅

Your support ticket *#${id}* has been resolved and closed.

We hope your issue was addressed to your satisfaction. If you have any further questions or the issue recurs, please don't hesitate to reach out again.

Thank you for choosing Bar-Tech! 🙏`,
        he: (id, name) =>
            `שלום${name ? ' ' + name : ''}! ✅

פנייתך *#${id}* טופלה ונסגרה.

אנו מקווים שהבעיה נפתרה לשביעות רצונך. אם יש לך שאלות נוספות או הבעיה חוזרת, אל תהסס/י לפנות אלינו שוב.

תודה שבחרת ב-Bar-Tech! 🙏`,
        ar: (id, name) =>
            `مرحباً${name ? ' ' + name : ''}! ✅

تم حل طلبك *#${id}* وإغلاقه.

نأمل أن تكون مشكلتك قد حُلّت بشكل مُرضٍ. إذا كان لديك أي أسئلة إضافية أو عادت المشكلة، لا تتردد في التواصل معنا مجدداً.

شكراً لاختيارك Bar-Tech! 🙏`,
    },
};

function getTemplate(event, lang, ticketId, customerName) {
    const eventTemplates = TEMPLATES[event];
    if (!eventTemplates) return null;
    const fn = eventTemplates[lang] || eventTemplates.en;
    return fn(ticketId, customerName);
}

// ── Core notification functions ───────────────────────────────────────────────

/**
 * notifyTicketOpened
 * Call when a new conversation/ticket is created.
 *
 * @param {object} opts
 * @param {string} opts.ticketId       - Chatwoot conversation ID
 * @param {string} opts.phone          - customer E.164 phone (for WhatsApp)
 * @param {string} opts.email          - customer email (for email fallback)
 * @param {string} opts.customerName   - customer display name
 * @param {string} opts.lang           - 'en' | 'he' | 'ar'
 */
async function notifyTicketOpened({ ticketId, phone, email, customerName, lang = 'en' }) {
    const message = getTemplate('opened', lang, ticketId, customerName);
    if (!message) return;

    logger.info(`[Lifecycle] Sending OPENED notification for ticket #${ticketId}`);

    const tasks = [];

    if (phone) {
        tasks.push(
            whatsappService.sendWhatsApp(phone, message)
                .then(() => logger.info(`[Lifecycle] WhatsApp OPENED sent to ${phone}`))
                .catch(err => logger.error(`[Lifecycle] WhatsApp OPENED failed: ${err.message}`))
        );
    }

    if (email) {
        tasks.push(
            emailService.sendEmail(
                email,
                `Your Bar-Tech Support Ticket #${ticketId} — Received`,
                message,
                message.replace(/\n/g, '<br>').replace(/\*/g, '<b>').replace(/\b(#\d+)\b/g, '<strong>$1</strong>')
            )
                .then(() => logger.info(`[Lifecycle] Email OPENED sent to ${email}`))
                .catch(err => logger.error(`[Lifecycle] Email OPENED failed: ${err.message}`))
        );
    }

    await Promise.allSettled(tasks);
}

/**
 * notifyTicketResolved
 * Call when a conversation is marked resolved/closed.
 */
async function notifyTicketResolved({ ticketId, phone, email, customerName, lang = 'en' }) {
    const message = getTemplate('resolved', lang, ticketId, customerName);
    if (!message) return;

    logger.info(`[Lifecycle] Sending RESOLVED notification for ticket #${ticketId}`);

    const tasks = [];

    if (phone) {
        tasks.push(
            whatsappService.sendWhatsApp(phone, message)
                .then(() => logger.info(`[Lifecycle] WhatsApp RESOLVED sent to ${phone}`))
                .catch(err => logger.error(`[Lifecycle] WhatsApp RESOLVED failed: ${err.message}`))
        );
    }

    if (email) {
        tasks.push(
            emailService.sendEmail(
                email,
                `Your Bar-Tech Support Ticket #${ticketId} — Resolved ✅`,
                message,
                message.replace(/\n/g, '<br>').replace(/\*/g, '<b>').replace(/\b(#\d+)\b/g, '<strong>$1</strong>')
            )
                .then(() => logger.info(`[Lifecycle] Email RESOLVED sent to ${email}`))
                .catch(err => logger.error(`[Lifecycle] Email RESOLVED failed: ${err.message}`))
        );
    }

    await Promise.allSettled(tasks);
}

module.exports = {
    notifyTicketOpened,
    notifyTicketResolved,
};
