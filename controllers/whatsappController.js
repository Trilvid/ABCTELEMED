// controllers/whatsappController.js
const VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN;
const { processMessage } = require('../services/botFlowService');

exports.verifyWebhook = (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        return res.status(200).send(challenge);
    }
    res.sendStatus(403);
};

exports.handleMessage = async (req, res) => {
    const body = req.body;
    res.sendStatus(200); // Always ACK immediately, process async

    const entry = body?.entry?.[0]?.changes?.[0]?.value;
    const message = entry?.messages?.[0];
    if (!message) return;

    try {
        await processMessage({
            from: message.from,
            type: message.type,
            text: message?.text?.body || '',
            message
        });
    } catch (error) {
        console.error('WhatsApp webhook processing error:', error.response?.data || error.message);
    }
};
