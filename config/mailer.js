// config/mailer.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, // use port 465 + secure true
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS // use Gmail App Password
  }
});

transporter.verify()
  .then(() => console.log('Mailer: SMTP ready'))
  .catch(err => console.warn('Mailer verify failed:', err && err.message ? err.message : err));

module.exports = transporter;
