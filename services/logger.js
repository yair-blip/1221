'use strict';

const winston  = require('winston');
const nodepath = require('path');
const fs       = require('fs');

const logsDir = nodepath.resolve(__dirname, '../logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// ─────────────────────────────────────────────────────────────────────────────
// ALERT TRANSPORT
// Fires on every logger.error() call.
// Sends via Telegram Bot (preferred) OR Gmail SMTP (fallback).
//
// To enable Telegram alerts, add to .env:
//   ALERT_TELEGRAM_BOT_TOKEN=123456:ABCdef...
//   ALERT_TELEGRAM_CHAT_ID=your_chat_id
//
// To enable Email alerts instead, add to .env:
//   ALERT_EMAIL_TO=admin@yourdomain.com
//   (uses existing EMAIL_USER / EMAIL_PASS / EMAIL_HOST)
// ─────────────────────────────────────────────────────────────────────────────
class AlertTransport extends winston.Transport {
    constructor(opts) {
        super(opts);
        this.name      = 'AlertTransport';
        this.level     = 'error';
        this._lastAlert = {}; // dedup: same message won't fire twice within 60s
    }

    log(info, callback) {
        setImmediate(() => this.emit('logged', info));

        const key = info.message;
        const now = Date.now();
        if (this._lastAlert[key] && (now - this._lastAlert[key]) < 60_000) {
            return callback();
        }
        this._lastAlert[key] = now;

        const meta = { ...info };
        delete meta.level; delete meta.message; delete meta.timestamp; delete meta.service;

        const body = [
            `🚨 <b>Bar-Tech AI — ERROR ALERT</b>`,
            `⏰ ${info.timestamp || new Date().toISOString()}`,
            `❌ ${info.message}`,
            Object.keys(meta).length ? `📋 ${JSON.stringify(meta)}` : '',
        ].filter(Boolean).join('\n');

        if (process.env.ALERT_TELEGRAM_BOT_TOKEN && process.env.ALERT_TELEGRAM_CHAT_ID) {
            this._sendTelegram(body).catch(err =>
                console.error('[AlertTransport] Telegram failed:', err.message)
            );
        } else if (process.env.EMAIL_USER && process.env.EMAIL_PASS && process.env.ALERT_EMAIL_TO) {
            this._sendEmail(body.replace(/<[^>]*>/g, '')).catch(err =>
                console.error('[AlertTransport] Email alert failed:', err.message)
            );
        }

        callback();
    }

    async _sendTelegram(text) {
        const https  = require('https');
        const token  = process.env.ALERT_TELEGRAM_BOT_TOKEN;
        const chatId = process.env.ALERT_TELEGRAM_CHAT_ID;
        const data   = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });

        return new Promise((resolve, reject) => {
            const req = https.request({
                hostname: 'api.telegram.org',
                path:     `/bot${token}/sendMessage`,
                method:   'POST',
                headers:  {
                    'Content-Type':   'application/json',
                    'Content-Length': Buffer.byteLength(data),
                },
            }, res => {
                res.on('data', () => {});
                res.on('end', resolve);
            });
            req.on('error', reject);
            req.write(data);
            req.end();
        });
    }

    async _sendEmail(text) {
        const nodemailer = require('nodemailer');
        const transport  = nodemailer.createTransport({
            host:   process.env.EMAIL_HOST   || 'smtp.gmail.com',
            port:   parseInt(process.env.EMAIL_PORT || '587', 10),
            secure: process.env.EMAIL_SECURE === 'true',
            auth:   { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
        });
        await transport.sendMail({
            from:    `"Bar-Tech AI" <${process.env.EMAIL_USER}>`,
            to:      process.env.ALERT_EMAIL_TO,
            subject: '🚨 Bar-Tech AI — Error Alert',
            text,
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Warn once at startup if no alert channel is configured
// ─────────────────────────────────────────────────────────────────────────────
function checkAlertConfig() {
    const hasTelegram = process.env.ALERT_TELEGRAM_BOT_TOKEN && process.env.ALERT_TELEGRAM_CHAT_ID;
    const hasEmail    = process.env.EMAIL_USER && process.env.EMAIL_PASS && process.env.ALERT_EMAIL_TO;
    if (!hasTelegram && !hasEmail) {
        console.warn('[logger] ⚠️  No alert channel configured. Set ALERT_TELEGRAM_BOT_TOKEN + ' +
            'ALERT_TELEGRAM_CHAT_ID (or ALERT_EMAIL_TO) in .env to receive error alerts.');
    }
}
// Defer so env is fully loaded before we check
setTimeout(checkAlertConfig, 2000);

// ─────────────────────────────────────────────────────────────────────────────
// Build and export logger
// ─────────────────────────────────────────────────────────────────────────────
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({
            filename: nodepath.join(logsDir, 'error.log'),
            level:    'error',
            maxsize:  10 * 1024 * 1024,
            maxFiles: 5,
            tailable: true,
        }),
        new winston.transports.File({
            filename: nodepath.join(logsDir, 'combined.log'),
            maxsize:  20 * 1024 * 1024,
            maxFiles: 5,
            tailable: true,
        }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ level, message, timestamp, ...meta }) => {
                    const extra = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
                    return `${timestamp} [${level}] ${message}${extra}`;
                })
            ),
        }),
        new AlertTransport(),
    ],
});

module.exports = logger;
