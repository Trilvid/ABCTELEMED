const express = require('express');
const crypto = require('crypto');
const Patient = require('../models/Patient');
const WaSession = require('../models/WaSession');
const whatsappService = require('../services/whatsappService');
const { PLANS } = require('../services/paystackService');

const router = express.Router();

router.post('/webhook', async (req, res) => {
    try {
        const rawBody = Buffer.isBuffer(req.body)
            ? req.body
            : Buffer.from(JSON.stringify(req.body || {}));

        const hash = crypto
            .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
            .update(rawBody)
            .digest('hex');

        if (hash !== req.headers['x-paystack-signature']) {
            return res.sendStatus(401);
        }

        const event = Buffer.isBuffer(req.body)
            ? JSON.parse(req.body.toString('utf8'))
            : req.body;

        if (event.event === 'charge.success') {
            const { metadata, status } = event.data;
            if (status !== 'success' || metadata?.type !== 'subscription') {
                return res.sendStatus(200);
            }

            const { patientId, phone, plan } = metadata;
            const planData = PLANS[plan];
            if (!planData) {
                return res.sendStatus(200);
            }

            const daysToAdd = planData.billing === 'annual' ? 365 : 30;
            const planExpiresAt = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000);

            await Patient.findByIdAndUpdate(patientId, { plan, planExpiresAt });
            await WaSession.updateOne({ phone }, { step: 'MAIN_MENU' });

            await whatsappService.sendButtons(
                phone,
                `Payment confirmed!\n\nYour *${planData.name}* is now active until ${planExpiresAt.toDateString()}.\n\n${plan.startsWith('premium') ? 'You now have instant doctor assignment.' : 'You can now access doctor consultations.'}`,
                [
                    { id: 'consult', title: 'See a doctor' },
                    { id: 'history', title: 'My history' }
                ]
            );
        }

        return res.sendStatus(200);
    } catch (err) {
        console.error('Paystack webhook error:', err.message);
        return res.sendStatus(200);
    }
});

router.get('/webhook/callback', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Payment callback received. Return to WhatsApp and type "check" to confirm your subscription.'
    });
});

module.exports = router;
