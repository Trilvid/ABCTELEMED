// services/whatsappService.js
const axios = require('axios');

const GRAPH_API_VERSION = process.env.WA_GRAPH_API_VERSION || 'v25.0';
const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}/${process.env.WA_PHONE_NUMBER_ID}/messages`;
const HEADERS = {
    Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
};

const trimText = (value, maxLength) => String(value || '').trim().slice(0, maxLength);
const sanitizePhone = (value) => String(value || '').replace(/[^\d]/g, '');

const normalizeButtons = (buttons) =>
    (buttons || [])
        .filter((button) => button?.id && button?.title)
        .slice(0, 3)
        .map((button) => ({
            type: 'reply',
            reply: {
                id: trimText(button.id, 256),
                title: trimText(button.title, 20)
            }
        }));

const normalizeRows = (rows) =>
    (rows || [])
        .filter((row) => row?.id && row?.title)
        .slice(0, 10)
        .map((row) => ({
            id: trimText(row.id, 200),
            title: trimText(row.title, 24),
            description: row.description ? trimText(row.description, 72) : undefined
        }));

exports.sendText = (to, body) =>
    axios.post(BASE_URL, {
        messaging_product: 'whatsapp',
        to: sanitizePhone(to),
        type: 'text',
        text: { body }
    }, { headers: HEADERS });

exports.sendButtons = (to, bodyText, buttons) =>
    axios.post(BASE_URL, {
        messaging_product: 'whatsapp',
        to: sanitizePhone(to),
        type: 'interactive',
        interactive: {
            type: 'button',
            body: { text: bodyText },
            action: {
                buttons: normalizeButtons(buttons)
            }
        }
    }, { headers: HEADERS });

exports.sendList = (to, bodyText, buttonText, rows) =>
    axios.post(BASE_URL, {
        messaging_product: 'whatsapp',
        to: sanitizePhone(to),
        type: 'interactive',
        interactive: {
            type: 'list',
            body: { text: bodyText },
            action: {
                button: trimText(buttonText, 20),
                sections: [{
                    title: 'Options',
                    rows: normalizeRows(rows)
                }]
            }
        }
    }, { headers: HEADERS });
