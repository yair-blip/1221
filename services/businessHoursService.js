'use strict';

/**
 * businessHoursService.js
 * ────────────────────────────────────────────────────────────────────────────
 * Global business hours logic for Bar-Tech.
 *
 * Operating hours: Sunday–Thursday, 08:00–16:00 (local server time or TZ env)
 * Outside those hours → send SMS + WhatsApp notification simultaneously.
 *
 * Timezone: Set BUSINESS_TZ in .env (e.g. "Asia/Jerusalem"). Defaults to UTC.
 * ────────────────────────────────────────────────────────────────────────────
 */

const whatsappService = require('./whatsappService');
const logger          = require('./logger');

// ── Configuration ─────────────────────────────────────────────────────────────
const TZ            = process.env.BUSINESS_TZ || 'Asia/Jerusalem';
const OPEN_HOUR     = parseInt(process.env.BUSINESS_OPEN_HOUR  || '8',  10); // 08:00
const CLOSE_HOUR    = parseInt(process.env.BUSINESS_CLOSE_HOUR || '16', 10); // 16:00
// Work days: 0=Sunday … 6=Saturday. Default: Sun(0)–Thu(4)
const WORK_DAYS     = (process.env.BUSINESS_WORK_DAYS || '0,1,2,3,4')
    .split(',').map(Number);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns a Date object for "now" in the configured timezone.
 * We derive local hour/weekday by formatting with Intl and parsing.
 */
function nowInTZ() {
    const now = new Date();
    // Build a locale string in the target TZ so we can read hour + weekday
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: TZ,
        hour:     'numeric',
        minute:   'numeric',
        weekday:  'short',
        hour12:   false,
    }).formatToParts(now);

    const get = type => parts.find(p => p.type === type)?.value;
    const weekdayStr = get('weekday'); // 'Sun','Mon','Tue','Wed','Thu','Fri','Sat'
    const hour       = parseInt(get('hour'),   10);
    const minute     = parseInt(get('minute'), 10);

    const weekdayMap = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
    const weekday    = weekdayMap[weekdayStr] ?? now.getDay();

    return { weekday, hour, minute, now };
}

/**
 * Returns true if we are currently within business hours.
 */
function isBusinessHours() {
    const { weekday, hour } = nowInTZ();
    if (!WORK_DAYS.includes(weekday)) return false;          // weekend
    if (hour < OPEN_HOUR || hour >= CLOSE_HOUR) return false; // outside hours
    return true;
}

/**
 * Returns a human-readable string of the next open time.
 */
function nextOpenDescription() {
    const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday'];
    const workDayNames = WORK_DAYS.map(d => dayNames[d]).filter(Boolean);
    return `${workDayNames[0]}–${workDayNames[workDayNames.length - 1]}, ${OPEN_HOUR}:00–${CLOSE_HOUR}:00`;
}

// ── Localised out-of-hours messages ──────────────────────────────────────────
function getOutOfHoursMessage(lang = 'en', channel = 'general') {
    const hours = nextOpenDescription();
    const msgs = {
        en: `Thank you for reaching out to Bar-Tech! 🕐\n\nOur team is currently offline. Our business hours are:\n📅 ${hours}\n\nYour message has been received and we will get back to you as soon as we reopen. For urgent technical issues please leave a detailed message and we will prioritise your request.`,
        he: `שלום ותודה שפנית ל בר-טק פתרונות מתקדמים.
משרדנו סגור כעת. שעות הפעילות שלנו הן בימים א'-ה' בין 08:00 ל-17:00.
פנייתך חשובה לנו מאוד – נציגנו יחזור אליך ביום העבודה הקרוב.
במידה ומדובר בתקלה טכנית דחופה, אנא פרט אותה כאן כדי שנוכל להיערך לטיפול מהיר.`,
        ar: `شكراً لتواصلك مع Bar-Tech! 🕐\n\nفريقنا غير متاح حالياً. ساعات العمل لدينا:\n📅 ${hours.replace('Sunday','الأحد').replace('Thursday','الخميس')}\n\nتم استلام رسالتك وسنرد عليك فور فتح المكتب. للدعم العاجل – يرجى ترك رسالة مفصّلة.`,
    };
    return msgs[lang] || msgs.en;
}

// ── SMS sender (Twilio REST — lightweight, no SDK required) ──────────────────
async function sendSMS(to, body) {
    const sid    = process.env.TWILIO_ACCOUNT_SID;
    const token  = process.env.TWILIO_AUTH_TOKEN;
    const from   = process.env.TWILIO_SMS_NUMBER; // a Twilio phone number

    if (!sid || !token || !from) {
        logger.warn('[BizHours] SMS skipped — Twilio SMS credentials not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_SMS_NUMBER)');
        return null;
    }

    try {
        const https  = require('https');
        const qs     = require('querystring');
        const auth   = Buffer.from(`${sid}:${token}`).toString('base64');
        const data   = qs.stringify({ To: to, From: from, Body: body });

        return await new Promise((resolve, reject) => {
            const req = https.request({
                hostname: 'api.twilio.com',
                path:     `/2010-04-01/Accounts/${sid}/Messages.json`,
                method:   'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type':  'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(data),
                },
            }, res => {
                let raw = '';
                res.on('data', c => raw += c);
                res.on('end', () => {
                    const json = JSON.parse(raw);
                    if (res.statusCode >= 400) {
                        logger.error(`[BizHours] Twilio SMS error: ${raw}`);
                        reject(new Error(`Twilio ${res.statusCode}`));
                    } else {
                        logger.info(`[BizHours] SMS sent to ${to} — sid: ${json.sid}`);
                        resolve(json);
                    }
                });
            });
            req.on('error', reject);
            req.write(data);
            req.end();
        });
    } catch (err) {
        logger.error(`[BizHours] SMS send failed: ${err.message}`);
        return null;
    }
}

// ── Main public API ───────────────────────────────────────────────────────────

/**
 * handleOutOfHours
 * Call this when a message arrives outside business hours.
 * Sends WhatsApp + SMS simultaneously.
 *
 * @param {string} phone  - E.164 phone number of the customer (e.g. +9720501234567)
 * @param {string} lang   - 'en' | 'he' | 'ar'
 * @param {string} channel - descriptive label for logging
 * @returns {Promise<void>}
 */
async function handleOutOfHours(phone, lang = 'en', channel = 'general') {
    if (!phone) {
        logger.warn('[BizHours] handleOutOfHours called with no phone number');
        return;
    }

    logger.info(`[BizHours] Outside business hours — notifying ${phone} (lang:${lang})`);

    const message = getOutOfHoursMessage(lang, channel);

    // Fire WhatsApp + SMS in parallel — we don't await individual failures
    const results = await Promise.allSettled([
        whatsappService.sendWhatsApp(phone, message),
        sendSMS(phone, message),
    ]);

    results.forEach((r, i) => {
        const label = i === 0 ? 'WhatsApp' : 'SMS';
        if (r.status === 'rejected') {
            logger.error(`[BizHours] ${label} notification failed: ${r.reason}`);
        } else {
            logger.info(`[BizHours] ${label} notification delivered`);
        }
    });
}

/**
 * checkAndNotifyIfClosed
 * Convenience wrapper: checks hours, fires notification only if outside hours.
 * Returns true if notification was sent (i.e. closed), false if open.
 */
async function checkAndNotifyIfClosed(phone, lang = 'en', channel = 'general') {
    if (isBusinessHours()) return false;
    await handleOutOfHours(phone, lang, channel);
    return true;
}

module.exports = {
    isBusinessHours,
    handleOutOfHours,
    checkAndNotifyIfClosed,
    nextOpenDescription,
    getOutOfHoursMessage,
    sendSMS,
};
