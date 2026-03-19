// services/whatsappService.js
const axios = require('axios');

const BASE_URL = `https://graph.facebook.com/v19.0/${process.env.WA_PHONE_NUMBER_ID}/messages`;
const HEADERS = {
    Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
};

exports.sendText = (to, body) =>
    axios.post(BASE_URL, {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body }
    }, { headers: HEADERS });

exports.sendButtons = (to, bodyText, buttons) =>
    axios.post(BASE_URL, {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
            type: 'button',
            body: { text: bodyText },
            action: {
                buttons: buttons.map(b => ({
                    type: 'reply',
                    reply: { id: b.id, title: b.title }
                }))
            }
        }
    }, { headers: HEADERS });

exports.sendList = (to, bodyText, buttonText, rows) =>
    axios.post(BASE_URL, {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
            type: 'list',
            body: { text: bodyText },
            action: {
                button: buttonText,
                sections: [{ title: 'Available Doctors', rows }]
            }
        }
    }, { headers: HEADERS });