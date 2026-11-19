// Sends email through any SMTP service (e.g. Gmail with an app password, Brevo, Resend).
// If SMTP is not configured, the message is printed to the server log instead (useful in development).
const nodemailer = require('nodemailer');

const configured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

let transport;
function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transport;
}

async function sendMail({ to, subject, text }) {
  if (!configured()) {
    console.log(`[email not configured] To: ${to} | ${subject}\n${text}`);
    return { logged: true };
  }
  await getTransport().sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text });
  return { sent: true };
}

module.exports = { sendMail, configured };
