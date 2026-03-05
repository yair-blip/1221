const nodemailer = require('nodemailer');
require('dotenv').config();

async function testMail() {
    console.log("--- מתחיל בדיקת שליחת אימייל מהתיקייה הנכונה ---");
    
    // בדיקה איזה משתנים הקוד מזהה
    const host = process.env.EMAIL_SMTP_HOST || process.env.EMAIL_HOST;
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;

    console.log("מנסה להתחבר לשרת:", host);
    console.log("משתמש:", user);

    let transporter = nodemailer.createTransport({
        host: host,
        port: process.env.EMAIL_SMTP_PORT || process.env.EMAIL_PORT || 465,
        secure: true, 
        auth: { user, pass }
    });

    try {
        let info = await transporter.sendMail({
            from: user,
            to: "support@bartec.co.il",
            subject: "בדיקת SMTP Bar-Tech",
            text: "הבדיקה עברה בהצלחה!"
        });
        console.log("✅ המייל נשלח בהצלחה!");
    } catch (error) {
        console.error("❌ שגיאה בשליחה:", error.message);
    }
}
testMail();
