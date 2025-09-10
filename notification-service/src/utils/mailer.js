// utils/mailer.js
const nodemailer = require('nodemailer');
const Notification = require('../models/Notification');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

// Verify transporter on startup
transporter.verify((error) => {
  if (error) {
    console.error("❌ Email transporter verification failed:", error);
  } else {
    console.log("✅ Email transporter ready to send emails");
  }
});

// A simple generic function

async function sendMail({ to, subject, text, html, recipientTeamId, type }) {
  try {
    const mailOptions = {
      from: `"Football Fixer Notifications" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text,
      html,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`📧 Email sent: ${info.messageId} → ${to}`);

    // Save notification
    await Notification.create({
      recipientTeamId,   // required
      type,              // required (invite | match.fixed | rejection)
      message: subject,  // required → keep it simple, use subject as message
      metadata: { to, subject, text, html },
      status: "sent",
    });

    return true;
  } catch (error) {
    console.error("❌ Error sending email:", error);

    // Persist failed notification attempt too
    await Notification.create({
      recipientTeamId,
      type,
      message: subject || "Notification failed",
      metadata: { to, subject, text, html, error: error.message },
      status: "failed",
    });

    return false;
  }
}

module.exports = { sendMail };
