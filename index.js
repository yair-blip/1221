const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const emailService = require('./services/emailService');

const app = express();
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);
const CHATWOOT_TOKEN = process.env.CHATWOOT_API_TOKEN;
const ACCOUNT_ID = process.env.ACCOUNT_ID || "2";

// --- פונקציות AI (הפרדה לפי תיבות) ---

async function askOpenAI(history) {
    const res = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: "אתה בר, נציג שירות בבר-טק." }, ...history],
        temperature: 0.3
    }, { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` } });
    return res.data.choices[0].message.content;
}

async function askClaude(history, newMessage) {
    // 1. נכין את ההיסטוריה ונכניס את ההודעה החדשה של המשתמש לסוף
    let fullHistory = [...history];
    
    if (newMessage) {
        fullHistory.push({ role: "user", content: newMessage });
    }

    // 2. ניקוי וסידור התפקידים
    let cleanHistory = fullHistory.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content ? String(m.content).trim() : ""
    })).filter(m => m.content !== "");

    // 3. איחוד הודעות כפולות (למנוע user אחרי user)
    const finalHistory = [];
    cleanHistory.forEach((msg) => {
        if (finalHistory.length === 0 || msg.role !== finalHistory[finalHistory.length - 1].role) {
            finalHistory.push(msg);
        } else {
            finalHistory[finalHistory.length - 1].content += "\n" + msg.content;
        }
    });

    // 4. וודוא שההודעה האחרונה היא תמיד של המשתמש (חובה עבור קלווד)
    while (finalHistory.length > 0 && finalHistory[finalHistory.length - 1].role !== 'user') {
        finalHistory.pop();
    }

    if (finalHistory.length === 0) {
        throw new Error("לא נמצאו הודעות משתמש תקינות");
    }

    console.log("📤 נשלח לקלווד סופית:", JSON.stringify(finalHistory));

    const msg = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        messages: finalHistory,
        system: "אתה בר, נציג שירות בבר-טק.",
    });

    return msg.content[0].text;
}
// --- Webhook: ניהול שיחות וואטסאפ (גרסה מתוקנת עבור קלווד) ---

app.post('/webhooks/chatwoot', async (req, res) => {
    // לוגים לבדיקת ההודעה הנכנסת מ-Chatwoot
    console.log("🔔 בקשה נכנסה מ-Chatwoot!");
    
    // שליפת הנתונים מהגוף של הבקשה - הוספנו את content
    const { event, message_type, conversation, content } = req.body;

    console.log("📦 סוג האירוע:", event);
    console.log("📨 סוג ההודעה:", message_type);
    console.log("📝 תוכן ההודעה:", content);

    // בדיקה שהאירוע רלוונטי
    if (message_type !== "incoming" || event !== "message_created") {
        console.log("⚠️ הבוט מתעלם מההודעה כי היא לא incoming או לא message_created");
        return res.status(200).send('Ignored');
    }

    try {
        // משיכת היסטוריית השיחה (תיקון הכתובת שנחתכה)
        const historyRes = await axios.get(`https://chat.bar-t.co.il/api/v1/accounts/${ACCOUNT_ID}/conversations/${conversation.id}/messages`, {
            headers: { 'api_access_token': CHATWOOT_TOKEN }
        });

        // עיבוד ההיסטוריה
        const chatHistory = (historyRes.data.payload || [])
            .filter(m => m.content && !m.private)
            .reverse()
            .slice(-10)
            .map(msg => ({
                role: msg.message_type === "incoming" ? "user" : "assistant",
                content: msg.content.replace(/<[^>]*>?/gm, '').trim()
            }));

        let botResponse = "";
        const inboxId = conversation.inbox_id;

        console.log(`🤖 מכין תגובה לתיבה מספר: ${inboxId}`);

        // ניתוב ל-AI המתאים
        if (inboxId === 7) {
            // התיקון הקריטי: מעבירים את ההיסטוריה יחד עם ההודעה החדשה (content)
            botResponse = await askClaude(chatHistory, content);
        } 
        else if (inboxId === 9) {
            botResponse = await askOpenAI(chatHistory);
        } 
        else if (inboxId === 5) {
            botResponse = await askGemini(chatHistory);
        }

        // שליחת התגובה חזרה ל-Chatwoot
        if (botResponse) {
            await axios.post(`https://chat.bar-t.co.il/api/v1/accounts/${ACCOUNT_ID}/conversations/${conversation.id}/messages`, {
                content: botResponse, 
                message_type: "outgoing"
            }, { 
                headers: { 'api_access_token': CHATWOOT_TOKEN } 
            });
            console.log("✅ תגובת AI נשלחה בהצלחה!");
        } else {
             console.log("⚠️ לא נוצרה תגובת AI (אולי התיבה לא מזוהה?)");
        }

        res.status(200).send('Success');

    } catch (e) {
        console.error("❌ שגיאה כללית ב-Webhook:", e.message);
        res.status(500).send('Error');
    }
});

// --- Portal: טופס אתר בעיצוב מותאם אישית ---

app.post('/portals/default/ticket', async (req, res) => {
    try {
        const name = req.body.name || req.body.שם || "לקוח ללא שם";
        const phone = req.body.phone || req.body.טלפון || "לא הוזן טלפון";
        const email = req.body.email || req.body.מייל || "yair@bartec.co.il";
        const subject = req.body.subject || req.body.נושא || req.body.title || "פנייה חדשה ממרכז התמיכה";
        const messageText = req.body.message || req.body.content || req.body.הודעה || req.body.comments || "לא הוזן תוכן";
        const branch = req.body.branch || req.body.סניף || "סניף ראשי";

        const ticketId = Math.floor(1000 + Math.random() * 9000);
        const accentColor = "#3b82f6"; // כחול בר-טק

        const htmlTemplate = (isClient) => `
            <div style="direction: rtl; font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
                <div style="background-color: #ffffff; padding: 25px; text-align: center; border-bottom: 2px solid #f3f4f6;">
                    <h1 style="color: ${accentColor}; margin: 0; font-size: 28px;">BarTech AI</h1>
                    <p style="color: #6b7280; margin: 5px 0 0 0;">מרכז שירות ותמיכה</p>
                </div>
                <div style="padding: 30px;">
                    <h2 style="color: #1f2937; font-size: 20px; border-right: 4px solid ${accentColor}; padding-right: 15px; margin-bottom: 25px;">
                        ${isClient ? `שלום ${name}, פנייתך התקבלה` : `קריאת שירות חדשה #${ticketId}`}
                    </h2>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px; font-size: 15px;">
                        <tr style="background-color: #f9fafb;"><td style="padding: 12px; font-weight: bold; color: #4b5563;">שם:</td><td style="padding: 12px;">${name}</td></tr>
                        <tr><td style="padding: 12px; font-weight: bold; color: #4b5563;">טלפון:</td><td style="padding: 12px;">${phone}</td></tr>
                        <tr style="background-color: #f9fafb;"><td style="padding: 12px; font-weight: bold; color: #4b5563;">נושא:</td><td style="padding: 12px;">${subject}</td></tr>
                        <tr><td style="padding: 12px; font-weight: bold; color: #4b5563;">סניף:</td><td style="padding: 12px;">${branch}</td></tr>
                    </table>
                    <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; border: 1px solid #e5e7eb;">
                        <div style="font-weight: bold; color: #4b5563; margin-bottom: 10px;">תיאור הפנייה:</div>
                        <div style="color: #1f2937; line-height: 1.6;">${messageText}</div>
                    </div>
                </div>
                <div style="background-color: #f9fafb; padding: 20px; text-align: center; font-size: 13px; color: #9ca3af;">
                    &copy; ${new Date().getFullYear()} BarTech AI - כל הזכויות שמורות
                </div>
            </div>
        `;

        await emailService.sendEmail("yair@bartec.co.il", `BarTech AI - פנייה #${ticketId}`, messageText, htmlTemplate(false));
        if (email && email.includes('@')) {
            await emailService.sendEmail(email, `אישור פנייה #${ticketId} - BarTech AI`, messageText, htmlTemplate(true));
        }

        res.status(200).json({ success: true, ticketId });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.listen(3001, () => console.log(`🚀 Server running on port 3001`));
