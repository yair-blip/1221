const express = require('express');
const router = express.Router();
const axios = require('axios');
const postmark = require("postmark");
// ייבוא השירות שמנהל את התור
const { addJob } = require('../services/queueService');

const client = new postmark.ServerClient("F6579ead-f8ab-446e-bf62-f6156be5db87");

// 1. הבוט של הוואטסאפ (תיבות 5, 7, 9)
router.post('/chatwoot', async (req, res) => {
    try {
        // אנחנו שולחים את ההודעה לתור. ה-Worker כבר ייקח אותה משם ויענה.
        if (addJob) {
            await addJob(req.body);
            console.log('✅ Message queued successfully');
        } else {
            console.error('❌ addJob not found in queueService');
        }
        res.status(200).send('ok');
    } catch (error) {
        console.error('Webhook Error:', error.message);
        res.status(200).send('ok'); 
    }
});

// 2. הטופס מהאתר (תיבה 13)
router.post('/form', async (req, res) => {
    const { name, company, email, phone, subject } = req.body;
    const baseURL = "https://chat.bar-t.co.il/api/v1/accounts/2";
    const apiToken = "CuQaTss4JDPsmtqRjMXW7oeM";
    
    try {
        const auth = { headers: { 'api_access_token': apiToken, 'Content-Type': 'application/json' } };
        let contactId;
        try {
            const cRes = await axios.post(`${baseURL}/contacts`, { name, email, phone_number: phone, custom_attributes: { company } }, auth);
            contactId = cRes.data.payload.contact.id;
        } catch (e) {
            const sRes = await axios.get(`${baseURL}/contacts/search?q=${email}`, auth);
            contactId = sRes.data.payload[0].id;
        }

        const convRes = await axios.post(`${baseURL}/conversations`, { inbox_id: 13, contact_id: contactId }, auth);
        const conversationId = convRes.data.id;

        await axios.post(`${baseURL}/conversations/${conversationId}/messages`, {
            content: `📬 פנייה חדשה מהאתר:\nשם: ${name}\nחברה: ${company}\nטלפון: ${phone}\nנושא: ${subject}`,
            message_type: "incoming"
        }, auth);

        await client.sendEmail({
            "From": "Info BarTech <info@bar-t.co.il>",
            "To": email,
            "Subject": `פנייתך לבר-טק התקבלה (#${conversationId})`,
            "HtmlBody": `<div dir="rtl"><h2>שלום ${name}, פנייתך #${conversationId} התקבלה בבר-טק.</h2></div>`,
            "MessageStream": "outbound"
        }).catch(() => {});

        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed' });
    }
});

module.exports = { router };
