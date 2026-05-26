const axios = require('axios');

const API_KEY = process.env.GUPSHUP_API_KEY;
const APP_NAME = process.env.GUPSHUP_APP_NAME;
const SOURCE = process.env.GUPSHUP_SOURCE_NUMBER;

async function sendTemplate(toPhone, templateName, params) {
  if (!API_KEY || !APP_NAME || !SOURCE) {
    console.warn('Gupshup not configured, skipping WhatsApp send');
    return null;
  }

  // Normalize phone (Indian numbers need 91 prefix)
  let destination = String(toPhone).replace(/\D/g, '');
  if (destination.length === 10) destination = '91' + destination;

  try {
    const body = new URLSearchParams({
      channel: 'whatsapp',
      source: SOURCE,
      destination,
      'src.name': APP_NAME,
      template: JSON.stringify({
        id: templateName,
        params,
      }),
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
