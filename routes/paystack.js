const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Patient = require('../models/Patient');
const WaSession = require('../models/WaSession');
const whatsappService = require('../services/whatsappService');
const { PLANS } = require('../services/paystackService');

// POST /api/paystack/webhook — Paystack server-to-server confirmation
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        // Verify the request is genuinely from Paystack
        const hash = crypto
            .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
            .update(req.body)
            .digest('hex');

        if (hash !== req.headers['x-paystack-signature']) {
            return res.sendStatus(401);
        }

        const event = JSON.parse(req.body);

        if (event.event === 'charge.success') {
            const { metadata, status } = event.data;
            if (status !== 'success' || metadata?.type !== 'subscription') {
                return res.sendStatus(200);
            }

            const { patientId, phone, plan } = metadata;
            const planData = PLANS[plan];

            // Upgrade patient plan — 30 days from now
            const planExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            await Patient.findByIdAndUpdate(patientId, { plan, planExpiresAt });

            // Update session so bot knows plan immediately
            await WaSession.updateOne({ phone }, { step: 'MAIN_MENU' });

            // Notify patient on WhatsApp
            await whatsappService.sendButtons(phone,
                `🎉 *Payment confirmed!*\n\nYour *${planData.name}* is now active until ${planExpiresAt.toDateString()}.\n\n${plan === 'premium' ? '⚡ You now have instant doctor assignment!' : '✅ You can now access all Basic features.'}`,
                [
                    { id: 'consult', title: '🩺 See a doctor' },
                    { id: 'history', title: '📋 My history' }
                ]
            );
        }

        res.sendStatus(200);
    } catch (err) {
        console.error('❌ Paystack webhook error:', err.message);
        res.sendStatus(200); // Always ACK Paystack
    }
});

module.exports = router;