// controllers/whatsappController.js
const VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN;
const { processMessage } = require('../services/botFlowService');

// ── Deduplication: track processed WhatsApp message IDs ──────────────────────
// Prevents double-processing when WhatsApp retries a delivery (e.g. Render cold
// start delays the 200 ACK and WhatsApp re-sends the same message).
// In-memory is fine — messages deduplicate within a ~2 min window, well within
// one server instance's lifetime. If you scale to multiple instances later,
// replace with a Redis SET with a 2-minute TTL.
const processedMessageIds = new Map(); // messageId → timestamp
const DEDUP_TTL_MS = 2 * 60 * 1000;  // 2 minutes

function isDuplicate(messageId) {
    if (!messageId) return false;
    const seen = processedMessageIds.get(messageId);
    if (seen) return true;

    processedMessageIds.set(messageId, Date.now());

    // Prune stale IDs so the map doesn't grow indefinitely
    for (const [id, ts] of processedMessageIds.entries()) {
        if (Date.now() - ts > DEDUP_TTL_MS) processedMessageIds.delete(id);
    }
    return false;
}

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
    // Always ACK immediately — this is critical.
    // If we delay the 200, WhatsApp will retry the delivery and the user gets
    // duplicate responses (especially bad on Render where cold starts add latency).
    res.sendStatus(200);

    const body = req.body;
    const entry = body?.entry?.[0]?.changes?.[0]?.value;
    const message = entry?.messages?.[0];
    if (!message) return;

    // Dedup check — skip if we already processed this message ID
    const messageId = message.id;
    if (isDuplicate(messageId)) {
        console.log(`⚠️  Duplicate message ignored: ${messageId}`);
        return;
    }

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