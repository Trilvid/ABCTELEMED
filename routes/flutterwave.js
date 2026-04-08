const express = require('express');
const Patient = require('../models/Patient');
const WaSession = require('../models/WaSession');
const Doctor = require('../models/Doctor');
const Consultation = require('../models/Consultation');
const whatsappService = require('../services/whatsappService');
const { PLANS } = require('../services/flutterwaveService');

const router = express.Router();

router.post('/webhook', async (req, res) => {
    try {
        if (!process.env.FLUTTERWAVE_WEBHOOK_HASH) {
            console.error('Flutterwave webhook error: missing FLUTTERWAVE_WEBHOOK_HASH');
            return res.sendStatus(500);
        }

        // Flutterwave uses a plain secret hash header, not HMAC
        if (req.headers['verif-hash'] !== process.env.FLUTTERWAVE_WEBHOOK_HASH) {
            return res.sendStatus(401);
        }

        const event = req.body;

        if (event.event === 'charge.completed') {
            const { meta, status } = event.data;
            if (status !== 'successful') return res.sendStatus(200);

            // ── Subscription payment ───
            if (meta?.type === 'subscription') {
                const { patientId, phone, plan } = meta;
                const planData = PLANS[plan];
                if (!planData || !patientId || !phone) {
                    console.error('Flutterwave subscription webhook error: invalid meta', meta);
                    return res.sendStatus(200);
                }

                const daysToAdd = planData.billing === 'annual' ? 365 : 30;
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
            if (meta?.type === 'consultation') {
                const { patientId, doctorId, consultationRef, phone } = meta;
                if (!patientId || !doctorId || !phone) {
                    console.error('Flutterwave consultation webhook error: invalid meta', meta);
                    return res.sendStatus(200);
                }

                const [patient, doctor] = await Promise.all([
                    Patient.findById(patientId).select('firstName lastName whatsappNumber'),
                    Doctor.findById(doctorId).select('firstName lastName whatsappNumber phone specialty consultationFee')
                ]);

                if (!patient || !doctor) {
                    console.error('Flutterwave consultation webhook error: missing patient or doctor', {
                        patientId,
                        doctorId,
                        consultationRef
                    });
                    return res.sendStatus(200);
                }

                const consultation = await Consultation.create({
                    patient: patientId,
                    doctor: doctorId,
                    scheduledAt: new Date(Date.now() + 30 * 60 * 1000),
                    symptoms: [],
                    status: 'confirmed',
                    isPaid: true,
                    fee: doctor.consultationFee,
                    channel: 'whatsapp',
                    flutterwaveReference: event.data.tx_ref
                });

                // ── Create Earning record (15% commission) ───
                const Earning = require('../models/Earning');
                const gross = doctor.consultationFee;
                const { commission, doctorAmount } = Earning.calculateSplit(gross);

                await Earning.create({
                    consultation: consultation._id,
                    doctor: doctor._id,
                    patient: patient._id,
                    grossAmount: gross,
                    commissionAmount: commission,
                    doctorAmount,
                    status: 'pending',
                    paymentGateway: 'flutterwave',
                    gatewayReference: event.data.tx_ref,
                });

                await Doctor.findByIdAndUpdate(doctorId, {
                    isAvailableNow: false,
                    activeConsultationId: consultation._id
                });

                const session = await WaSession.findOne({ phone });
                if (session?.data?.symptoms?.length) {
                    await Consultation.findByIdAndUpdate(consultation._id, {
                        symptoms: session.data.symptoms,
                        aiSummary: session.data.aiSummary || null,
                        urgency: session.data.urgency || null
                    });
                }

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
                        console.log(`Doctor notified via Flutterwave webhook: ${doctorNumber}`);
                    } catch (e) {
                        console.error(`Doctor notify failed: ${e.message}`);
                    }
                }

                await WaSession.updateOne({ phone }, {
                    step: 'BOOKING_COMPLETE',
                    data: { consultationId: consultation._id }
                });

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
        console.error('Flutterwave webhook error:', err.message);
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
