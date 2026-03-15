const postmark = require("postmark");

class EmailService {
    constructor() {
        if (process.env.POSTMARK_TOKEN) {
            this.client = new postmark.ServerClient(process.env.POSTMARK_TOKEN);
        } else {
            console.error('[Email] POSTMARK_TOKEN missing');
        }
    }

    async sendEmail(to, subject, text, html = null) {
        if (!this.client) return null;
        try {
            return await this.client.sendEmail({
                "From": "info@bar-t.co.il",
                "To": to,
                "Subject": subject,
                "TextBody": text,
                "HtmlBody": html || text,
                "MessageStream": "outbound"
            });
        } catch (err) {
            console.error(`[Email] Error: ${err.message}`);
            throw err;
        }
    }
}

module.exports = new EmailService();
