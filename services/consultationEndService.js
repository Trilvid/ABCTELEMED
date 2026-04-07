// services/consultationEndService.js

const Consultation = require('../models/Consultation');
const Doctor = require('../models/Doctor');
const Patient = require('../models/Patient');
const WaSession = require('../models/WaSession');
const whatsappService = require('./whatsappService');


exports.endConsultation = async (consultationId, options = {}) => {
    const consultation = await Consultation.findById(consultationId)
        .populate('patient', 'firstName whatsappNumber')
        .populate('doctor', 'firstName lastName isOnCall');

    if (!consultation) throw new Error('Consultation not found');

    if (consultation.status === 'completed') {
        throw new Error('Consultation is already completed');
    }

    // ── 1. Mark consultation completed ─────────────────────────────────────────
    const now = new Date();
    const startedAt = consultation.startedAt || consultation.scheduledAt;
    const durationMinutes = Math.round((now - startedAt) / 60000);

    consultation.status = 'completed';
    consultation.endedAt = now;
    consultation.duration = durationMinutes;

    if (options.doctorNotes) consultation.doctorNotes = options.doctorNotes;
    if (options.diagnosis) consultation.diagnosis = options.diagnosis;
    if (options.prescriptions) consultation.prescriptions = options.prescriptions;
    if (options.followUpDate) consultation.followUpDate = options.followUpDate;

    await consultation.save();

    // ── 2. Free the doctor ─────────────────────────────────────────────────────
    await Doctor.findByIdAndUpdate(consultation.doctor._id, {
        isAvailableNow: consultation.doctor.isOnCall ? true : false, // restore if on-call
        activeConsultationId: null
    });

    // ── 3. Update patient's doctor totalConsultations stat ─────────────────────
    await Doctor.findByIdAndUpdate(consultation.doctor._id, {
        $inc: { totalConsultations: 1 }
    });

    // ── 4. Prompt patient for review via WhatsApp ──────────────────────────────
    const patient = consultation.patient;
    const patientPhone = patient?.whatsappNumber;

    if (patientPhone) {
        try {
            // Update patient session to REVIEW_DOCTOR
            await WaSession.findOneAndUpdate(
                { phone: patientPhone },
                {
                    step: 'REVIEW_DOCTOR',
                    'data.reviewConsultationId': consultationId,
                    'data.reviewDoctorName': `Dr. ${consultation.doctor.firstName} ${consultation.doctor.lastName}`
                }
            );

            // Send review prompt
            await whatsappService.sendButtons(
                patientPhone,
                `Your consultation with *Dr. ${consultation.doctor.firstName} ${consultation.doctor.lastName}* has ended.\n\nHow would you rate this consultation?`,
                [
                    { id: 'review_1', title: '⭐ 1 - Poor' },
                    { id: 'review_2', title: '⭐⭐ 2 - Fair' },
                    { id: 'review_3', title: '⭐⭐⭐ 3 - Good' }
                ]
            );

            // WhatsApp buttons are capped at 3, so send second set as a list
            await whatsappService.sendList(
                patientPhone,
                'Or choose a higher rating:',
                'More options',
                [
                    { id: 'review_4', title: '⭐⭐⭐⭐ 4 - Very Good', description: 'I was quite satisfied' },
                    { id: 'review_5', title: '⭐⭐⭐⭐⭐ 5 - Excellent', description: 'Outstanding experience' },
                    { id: 'review_skip', title: 'Skip review', description: 'No thanks' }
                ]
            );
        } catch (e) {
            // Notification failure should not block the end-consultation response
            console.error('❌ Review prompt failed:', e.message);
        }
    }

    return consultation;
};