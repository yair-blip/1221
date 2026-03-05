# Deployment & Testing Guide

## Why the bot sends wrong messages

The code in this zip is correct and tested. If the bot is still sending system instructions or wrong text, **one of these is the cause**:

### Cause 1: Old code is still running (most likely)
```bash
# On your server, check what version is running
cat ~/your-app-folder/routes/webhooks.js | grep "recentlySent"
# If you see nothing → old code. Deploy the new zip.
```

### Cause 2: OPENAI_API_KEY is wrong
```bash
# Run this on your server inside the app folder:
node diagnose.js
# It will tell you exactly what's broken.
```

### Cause 3: Chatwoot has its own Automation rules sending messages
```
Chatwoot → Settings → Automation
Delete any rule that says "Send a message" or "Auto-reply"
These fire BEFORE our webhook and send their own messages.
```

### Cause 4: Multiple webhook URLs configured
```
Chatwoot → Settings → Integrations → Webhooks
There must be ONLY ONE webhook URL pointing to your server.
Delete duplicates.
```

---

## Deploy new code

```bash
# On your server:
cd /path/to/your/app

# Backup old code
cp -r . ../backup-$(date +%Y%m%d)

# Extract new zip
unzip -o mvp_final_100pct.zip -d /tmp/newcode
cp -r /tmp/newcode/edited_mvp/* .

# Install dependencies
npm install

# Restart server
pm2 restart bar-tech-ai
# OR if not using pm2:
pkill -f "node index.js" && node index.js &
```

## Verify it's working (takes 30 seconds)

```bash
# 1. Make sure server is running
curl http://localhost:3000/health

# 2. Run full diagnostic
node diagnose.js

# 3. Simulate an incoming customer message (while server is running)
node simulate-chatwoot.js "Hello I need help with my device"

# 4. Watch logs for the AI call
pm2 logs bar-tech-ai --lines 20
# You must see:
# [AI] Processing conv 12345: "Hello I need..."
# [AI] Calling gpt-4o with N messages
# [AI] Got reply (XX chars)
# [AI] ✓ Reply sent for conv 12345
```

## Test handoff specifically

```bash
node simulate-chatwoot.js "I want to speak with a human agent"
# In Chatwoot you must see:
# 1. Bot sends "Connecting you to a human agent now."
# 2. Conversation status changes to "Pending"
# 3. A private internal note appears with the AI summary

node simulate-chatwoot.js "אני רוצה נציג אנושי"
# Bot must reply in Hebrew: "מעביר אותך עכשיו לנציג אנושי..."

node simulate-chatwoot.js "اريد موظف بشري"
# Bot must reply in Arabic: "جاري تحويلك الآن..."
```

## .env checklist — all required values

```env
OPENAI_API_KEY=sk-...          ← Get from platform.openai.com/api-keys
CHATWOOT_API_URL=https://...   ← Your Chatwoot domain
CHATWOOT_API_TOKEN=...         ← Chatwoot → Profile → Access Token
CHATWOOT_ACCOUNT_ID=2          ← The number in your Chatwoot URL
CHATWOOT_WEBHOOK_SECRET=...    ← Must match what you set in Chatwoot webhook config
CHATWOOT_INBOX_ID=5            ← Chatwoot → Settings → Inboxes → your inbox id
```
