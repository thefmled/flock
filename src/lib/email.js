const axios = require('axios');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'Flock <onboarding@resend.dev>';

async function sendOtpEmail(toEmail, code) {
  try {
    const response = await axios.post(
      'https://api.resend.com/emails',
      {
        from: FROM_EMAIL,
        to: toEmail,
        subject: 'Your Flock login code',
        html: `
          <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px;">
            <h2 style="font-size: 20px; margin-bottom: 24px;">Your Flock login code</h2>
            <p style="font-size: 16px; color: #333;">Use the code below to log in to your Flock account:</p>
            <div style="font-size: 32px; font-weight: 600; letter-spacing: 8px; margin: 24px 0; padding: 16px; background: #f5f5f5; text-align: center; border-radius: 8px;">
              ${code}
            </div>
            <p style="font-size: 14px; color: #888;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
          </div>
        `,
      },
      {
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error('Email send failed:', error.response?.data || error.message);
    throw new Error('Failed to send email');
  }
}

module.exports = { sendOtpEmail };
