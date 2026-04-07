const express = require('express');
const crypto = require('crypto');
const Patient = require('../models/Patient');
const WaSession = require('../models/WaSession');
const Doctor = require('../models/Doctor');
const Consultation = require('../models/Consultation');
const whatsappService = require('../services/whatsappService');
const { PLANS } = require('../services/paystackService');

const router = express.Router();

router.post('/webhook', async (req, res) => {
    try {
        if (!process.env.PAYSTACK_SECRET_KEY) {
            console.error('Paystack webhook error: missing PAYSTACK_SECRET_KEY');
            return res.sendStatus(500);
        }

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

        // if (event.event === 'charge.success') {
        //     const { metadata, status } = event.data;
        //     if (status !== 'success' || metadata?.type !== 'subscription') {
        //         return res.sendStatus(200);
        //     }

        //     const { patientId, phone, plan } = metadata;
        //     const planData = PLANS[plan];
        //     if (!planData) {
        //         return res.sendStatus(200);
        //     }

        //     const daysToAdd = planData.billing === 'annual' ? 365 : 30;
        //     const planExpiresAt = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000);

        //     await Patient.findByIdAndUpdate(patientId, { plan, planExpiresAt });
        //     await WaSession.updateOne({ phone }, { step: 'MAIN_MENU' });

        //     await whatsappService.sendButtons(
        //         phone,
        //         `Payment confirmed!\n\nYour *${planData.name}* is now active until ${planExpiresAt.toDateString()}.\n\n${plan.startsWith('premium') ? 'You now have instant doctor assignment.' : 'You can now access doctor consultations.'}`,
        //         [
        //             { id: 'consult', title: 'See a doctor' },
        //             { id: 'history', title: 'My history' }
        //         ]
        //     );
        // }

        if (event.event === 'charge.success') {
            const { metadata, status } = event.data;
            if (status !== 'success') return res.sendStatus(200);

            // ── Subscription payment ───
            if (metadata?.type === 'subscription') {
                const { patientId, phone, plan } = metadata;
                const planData = PLANS[plan];
                if (!planData || !patientId || !phone) {
                    console.error('Paystack subscription webhook error: invalid metadata', metadata);
                    return res.sendStatus(200);
                }
                const daysToAdd = planData?.billing === 'annual' ? 365 : 30;
                const planExpiresAt = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000);

                await Patient.findByIdAndUpdate(patientId, { plan, planExpiresAt });
                await WaSession.updateOne({ phone }, { step: 'MAIN_MENU' });

                await whatsappService.sendButtons(phone,
                    `Payment confirmed!\n\n${planData.name} is now active until ${planExpiresAt.toDateString()}.\n\n${plan.startsWith('premium') ? 'You now have instant doctor assignment.' : 'You can now access doctor consultations.'}`,
                    [
                        { id: 'consult', title: 'See a doctor' },
                        { id: 'history', title: 'My history' },
                        { id: 'subscribe', title: 'My plan' }
                    ]
                );
            }

            // ── Consultation payment ───
            if (metadata?.type === 'consultation') {
                const { patientId, doctorId, consultationRef, phone } = metadata;
                if (!patientId || !doctorId || !phone) {
                    console.error('Paystack consultation webhook error: invalid metadata', metadata);
                    return res.sendStatus(200);
                }

                const [patient, doctor] = await Promise.all([
                    Patient.findById(patientId).select('firstName lastName whatsappNumber'),
                    Doctor.findById(doctorId).select('firstName lastName whatsappNumber phone specialty consultationFee')
                ]);

                if (!patient || !doctor) {
                    console.error('Paystack consultation webhook error: missing patient or doctor', {
                        patientId,
                        doctorId,
                        consultationRef
                    });
                    return res.sendStatus(200);
                }

                // Create the consultation now that payment is confirmed
                const consultation = await Consultation.create({
                    patient: patientId,
                    doctor: doctorId,
                    scheduledAt: new Date(Date.now() + 30 * 60 * 1000),
                    symptoms: [],   // pulled from session below
                    status: 'confirmed',
                    isPaid: true,
                    fee: doctor.consultationFee,
                    channel: 'whatsapp',
                    paystackReference: event.data.reference
                });

                // Mark doctor as busy
                await Doctor.findByIdAndUpdate(doctorId, {
                    isAvailableNow: false,
                    activeConsultationId: consultation._id
                });

                // Pull symptoms from session to update consultation
                const session = await WaSession.findOne({ phone });
                if (session?.data?.symptoms?.length) {
                    await Consultation.findByIdAndUpdate(consultation._id, {
                        symptoms: session.data.symptoms,
                        aiSummary: session.data.aiSummary || null,
                        urgency: session.data.urgency || null
                    });
                }

                // Notify doctor
                const doctorNumber = (doctor.whatsappNumber || doctor.phone || '').replace(/[\s\-\+]/g, '');
                if (doctorNumber) {
                    try {
                        await whatsappService.sendText(doctorNumber,
                            `New Paid Consultation\n\n` +
                            `Patient: ${patient.firstName} ${patient.lastName}\n` +
                            `WhatsApp: +${patient.whatsappNumber}\n` +
                            `Specialty: ${doctor.specialty.replace('_', ' ')}\n` +
                            `Symptoms: ${(session?.data?.symptoms || []).join(', ')}\n` +
                            `Urgency: ${session?.data?.urgency || 'N/A'}\n` +
                            `Fee paid: N${doctor.consultationFee.toLocaleString()}\n` +
                            `Ref: ${consultation._id}\n\n` +
                            `Please contact the patient on WhatsApp to begin.`
                        );
                        console.log(`✅ Doctor notified via Paystack webhook: ${doctorNumber}`);
                    } catch (e) {
                        console.error(`❌ Doctor notify failed: ${e.message}`);
                    }
                }

                // Update patient session
                await WaSession.updateOne({ phone }, {
                    step: 'BOOKING_COMPLETE',
                    data: {
                        consultationId: consultation._id
                    }
                });

                // Confirm to patient
                await whatsappService.sendText(phone,
                    `Payment confirmed! Booking complete.\n\n` +
                    `Dr. ${doctor.firstName} ${doctor.lastName}\n` +
                    `Specialty: ${doctor.specialty.replace('_', ' ')}\n` +
                    `Ref: ${consultation._id}\n\n` +
                    `The doctor has been notified and will contact you shortly.\n\nType anything to return to the menu.`
                );
            }
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
        message: 'Payment callback received. Return to WhatsApp and type "check" to confirm your payment.'
    });
});

module.exports = router;