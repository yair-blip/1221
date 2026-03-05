'use strict';

require('dotenv').config();
const nodemailer = require('nodemailer');
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const logger = require('./logger');

class EmailService {
    constructor() {
        const smtpPort = parseInt(process.env.EMAIL_PORT || '587', 10);
        const smtpSecure = process.env.EMAIL_SECURE === 'true' || smtpPort === 465;

        this.transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: smtpPort,
            secure: smtpSecure,
            requireTLS: !smtpSecure,
            auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
            tls: { rejectUnauthorized: false },
        });

        this.imapConfig = {
            imap: {
                user: process.env.EMAIL_USER,
                password: process.env.EMAIL_PASS,
                host: process.env.EMAIL_IMAP_HOST || process.env.EMAIL_HOST,
                port: parseInt(process.env.EMAIL_IMAP_PORT || '993', 10),
                tls: process.env.EMAIL_IMAP_TLS !== 'false',
                tlsOptions: { rejectUnauthorized: false },
                authTimeout: 10_000,
                connTimeout: 20_000,
            },
        };
    }

    async pollForNewEmails(callback) {
        logger.info('[Email] Polling IMAP…');
        let connection;
        try {
            connection = await imaps.connect(this.imapConfig);
            await connection.openBox('INBOX');
            const items = await connection.search(['UNSEEN'], { bodies: [''], markSeen: true });
            logger.info(`[Email] ${items.length} new message(s) found`);

            for (const item of items) {
                try {
                    const part = item.parts.find(p => p.which === '');
                    if (!part) continue;
                    const mail = await simpleParser(part.body);
                    const from = mail.from?.value?.[0]?.address;
                    if (!from) continue;
                    await callback({
                        from,
                        subject: mail.subject || '(no subject)',
                        text: mail.text || '',
                        html: mail.html || null,
                        date: mail.date || new Date(),
                    });
                } catch (e) {
                    logger.error(`[Email] Error parsing message: ${e.message}`);
                }
            }
        } catch (err) {
            logger.error(`[Email] IMAP error: ${err.message}`);
            throw err;
        } finally {
            if (connection) { try { connection.end(); } catch (_) { } }
        }
    }

    async sendEmail(to, subject, text, html = null) {
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            logger.warn(`[Email] sendEmail aborted: EMAIL_USER or EMAIL_PASS not configured.`);
            return null;
        }
        try {
            logger.info(`[Email] Sending → ${to} | "${subject}"`);
            const info = await this.transporter.sendMail({
                from: `Bar-Tech Support <${process.env.EMAIL_USER}>`,
                to, subject, text,
                html: html || text,
            });
            logger.info(`[Email] Sent — messageId: ${info.messageId}`);
            return info;
        } catch (err) {
            logger.error(`[Email] sendEmail FAILED to ${to}: ${err.message}`);
            throw err;
        }
    }
}

module.exports = new EmailService();
