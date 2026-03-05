# Bar-Tech AI MVP

AI-powered customer service automation integrating **Chatwoot**, **WhatsApp (Meta)**, **3CX**, and **Email**.

---

## Architecture

```
Customer WhatsApp/Email
        ↓
   Chatwoot (CRM)
        ↓  (webhook)
  This Server (Node.js)
   ├── AI Pipeline (OpenAI GPT-4o)
   │    ├── Data extraction
   │    ├── Sentiment analysis
   │    ├── Auto-reply
   │    └── Human handoff
   ├── WhatsApp sender (Meta API)
   ├── Email sender/poller (SMTP/IMAP)
   ├── 3CX call handler
   └── SQLite DB + Dashboard
```

---

## Quick Start

### 1. Install
```bash
npm install
```

### 2. Configure
```bash
cp .env.example .env
# Edit .env with your real credentials
```

### 3. Check readiness
```bash
node check-production.js
```

### 4. Run
```bash
# Development
npm run dev

# Production (PM2)
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # auto-start on server reboot
```

---

## Webhook Setup

### Chatwoot
1. Go to **Settings → Integrations → Webhooks**
2. Add URL: `https://your-server.com/webhooks/chatwoot`
3. Enable events: `message_created`, `conversation_created`, `conversation_updated`
4. Set **HMAC Token** to match `CHATWOOT_WEBHOOK_SECRET` in your `.env`

### 3CX
Configure CRM Integration in 3CX to POST to:
```
https://your-server.com/webhooks/3cx
```
With header: `x-api-key: YOUR_INTERNAL_API_KEY`

Body format:
```json
{
  "phoneNumber": "+972501234567",
  "callStatus": "missed",
  "department": "Support",
  "customerName": "John Doe",
  "did": "03-1234567",
  "dn": "101"
}
```

### WhatsApp Meta Webhook
1. In Meta Developer Console → your App → WhatsApp → Configuration
2. Callback URL: `https://your-server.com/webhooks/whatsapp`
3. Verify token: match `WHATSAPP_VERIFY_TOKEN` in `.env`

---

## Service Profiles (AI Behavior)

Edit `services/configService.js` to customize AI behavior per inbox:

```js
'Your Inbox Name': {
    tone:           'Friendly and Professional',
    requiredFields: ['name', 'phone', 'issueDescription'],
    prompt:         'Help customers with...',
    handoffRules:   ['refund', 'legal', 'emergency'],
}
```

The inbox name **must exactly match** the inbox name in Chatwoot.

---

## Testing

```bash
# Test 3CX missed call flow
node simulate-3cx.js missed Support +972501234567

# Test 3CX handled call
node simulate-3cx.js handled Sales +972501234567

# Test AI auto-reply (English)
node simulate-chatwoot.js "Hello I need help with my fleet"

# Test AI auto-reply (Arabic)
node simulate-chatwoot.js "مرحبا اريد مساعدة"

# Test handoff trigger
node simulate-chatwoot.js "I need a human agent please"
```

---

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /health` | Server health check |
| `GET /api/reports` | Aggregated dashboard data |
| `GET /api/reports/customer/:id` | Per-customer report |
| `POST /webhooks/chatwoot` | Chatwoot webhook receiver |
| `POST /webhooks/3cx` | 3CX call webhook receiver |
| `GET /webhooks/whatsapp` | Meta webhook verification |

---

## Monitoring

```bash
# View live logs
pm2 logs bar-tech-ai

# Monitor CPU/memory
pm2 monit

# View log files
tail -f logs/combined.log
tail -f logs/error.log
```

---

## Environment Variables

See `.env.example` for all required variables with descriptions.

**Critical ones:**
- `OPENAI_API_KEY` — OpenAI API key
- `CHATWOOT_API_URL` — Your Chatwoot URL
- `CHATWOOT_API_TOKEN` — Chatwoot agent token
- `CHATWOOT_WEBHOOK_SECRET` — HMAC secret (must match Chatwoot config)
- `WHATSAPP_API_TOKEN` — Meta WhatsApp token
- `WHATSAPP_PHONE_NUMBER_ID` — Meta phone number ID
- `INTERNAL_API_KEY` — Secret for 3CX webhook auth

---

## Folder Structure

```
├── index.js                  # Entry point
├── ecosystem.config.js       # PM2 config
├── routes/
│   └── webhooks.js           # All webhook handlers
├── services/
│   ├── aiService.js          # OpenAI integration
│   ├── chatwootService.js    # Chatwoot API client
│   ├── whatsappService.js    # WhatsApp sender (Meta/Twilio)
│   ├── emailService.js       # SMTP + IMAP
│   ├── dbService.js          # SQLite database
│   ├── configService.js      # Service profiles & inbox mapping
│   └── logger.js             # Winston logger
├── middleware/
│   └── authMiddleware.js     # HMAC + API key verification
├── public/
│   └── index.html            # Dashboard
├── data/
│   └── mvp.db                # SQLite database (auto-created)
├── logs/                     # Log files (auto-created)
├── check-production.js       # Pre-deploy readiness check
├── simulate-3cx.js           # 3CX test utility
├── simulate-chatwoot.js      # Chatwoot/AI test utility
└── .env.example              # Environment template
```
