const axios = require('axios');

const API_KEY = process.env.GUPSHUP_API_KEY;
const APP_NAME = process.env.GUPSHUP_APP_NAME;
const SOURCE = process.env.GUPSHUP_SOURCE_NUMBER;

async function sendTemplate(toPhone, templateName, params, buttonParams = null) {
  // Sanitized log, masks phone, doesn't log params
  const maskedPhone = String(toPhone || '').replace(/^(\d{2})(\d+)(\d{2})$/, '$1***$3');
  console.log('WA SEND:', { phone: maskedPhone, template: templateName });
  if (!API_KEY || !APP_NAME || !SOURCE) {
    console.warn('Gupshup not configured, skipping WhatsApp send');
    return null;
  }

  // Normalize to a bare 91XXXXXXXXXX (no '+'). Strip a leading 0 (e.g. 0XXXXXXXXXX) and a
  // leading 91 country code if already present, then prepend 91. This is idempotent, an
  // already-prefixed '919876543210' normalizes back to itself instead of becoming '9191...'.
  let destination = String(toPhone).replace(/\D/g, '');
  if (destination.startsWith('0')) destination = destination.slice(1);
  if (destination.length === 12 && destination.startsWith('91')) destination = destination.slice(2);
  if (destination.length === 10) destination = '91' + destination;
  try {
    const template = {
      id: templateName,
      params: buttonParams ? [...params, ...buttonParams] : params,
    };

    const body = new URLSearchParams({
      channel: 'whatsapp',
      source: SOURCE,
      destination,
      'src.name': APP_NAME,
      template: JSON.stringify(template),
    });

    const response = await axios.post(
      'https://api.gupshup.io/wa/api/v1/template/msg',
      body.toString(),
      {
        headers: {
          'apikey': API_KEY,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error('Gupshup send failed:', error.response?.data || error.message);
    return null;
  }
}

module.exports = { sendTemplate };
