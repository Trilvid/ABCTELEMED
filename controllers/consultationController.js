const mongoose = require('mongoose');
const Consultation = require('../models/Consultation');
const Doctor = require('../models/Doctor');
const Patient = require('../models/Patient');
const { endConsultation } = require('../services/consultationEndService');

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);
const clampLimit = (value, fallback = 10, max = 100) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, max);
};

const ensureDoctorOwnsResource = (req, doctorId) =>
    req.doctor && req.doctor._id.toString() === doctorId.toString();

// ─── POST /api/consultations ──────────────────────────────────────────────────
exports.createConsultation = async (req, res, next) => {
    try {
        const { patientId, doctorId, scheduledAt, symptoms, channel } = req.body;
        if (!isValidObjectId(patientId) || !isValidObjectId(doctorId)) {
            return res.status(400).json({ status: 'error', message: 'Invalid patient or doctor identifier.' });
        }
        if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) {
            return res.status(400).json({ status: 'error', message: 'A valid consultation date is required.' });
        }

        const [patient, doctor] = await Promise.all([
            Patient.findById(patientId),
            Doctor.findById(doctorId)
        ]);

        if (!patient) return res.status(404).json({ status: 'error', message: 'Patient not found.' });
        if (!doctor) return res.status(404).json({ status: 'error', message: 'Doctor not found.' });
        if (doctor.status !== 'verified')
            return res.status(400).json({ status: 'error', message: 'Doctor is not available.' });

        // Check for clashing booking on same doctor at same time
        const clash = await Consultation.findOne({
            doctor: doctorId,
            scheduledAt: new Date(scheduledAt),
            status: { $in: ['pending', 'confirmed'] }
        });
        if (clash)
            return res.status(409).json({ status: 'error', message: 'That slot is already booked.' });

        const consultation = await Consultation.create({
            patient: patientId,
            doctor: doctorId,
            scheduledAt: new Date(scheduledAt),
            symptoms: symptoms || [],
            fee: doctor.consultationFee,
            channel: channel || 'whatsapp'
        });

        // Increment doctor consultation count
        await Doctor.findByIdAndUpdate(doctorId, { $inc: { totalConsultations: 1 } });
        await Patient.findByIdAndUpdate(patientId, {
            $inc: { totalConsultations: 1 },
            lastConsultationAt: new Date()
        });

        res.status(201).json({
            status: 'success',
            data: { consultation }
        });
    } catch (err) {
        next(err);
    }
};

// ─── GET /api/consultations/:id ───────────────────────────────────────────────
exports.getConsultation = async (req, res, next) => {
    try {
        const consultation = await Consultation.findById(req.params.id)
            .populate('patient', 'firstName lastName whatsappNumber')
            .populate('doctor', 'firstName lastName specialty photo');

        if (!consultation)
            return res.status(404).json({ status: 'error', message: 'Consultation not found.' });

        res.status(200).json({ status: 'success', data: { consultation } });
    } catch (err) {
        next(err);
    }
};

// ─── GET /api/consultations/patient/:patientId ────────────────────────────────
exports.getPatientConsultations = async (req, res, next) => {
    try {
        const { status, page = 1, limit = 10 } = req.query;
        if (!isValidObjectId(req.params.patientId)) {
            return res.status(400).json({ status: 'error', message: 'Invalid patient identifier.' });
        }
        const filter = { patient: req.params.patientId };
        if (status) filter.status = status;

        const safePage = clampLimit(page, 1, 1000000);
        const safeLimit = clampLimit(limit, 10, 100);
        const skip = (safePage - 1) * safeLimit;
        const [consultations, total] = await Promise.all([
            Consultation.find(filter)
                .populate('doctor', 'firstName lastName specialty photo rating')
                .sort({ scheduledAt: -1 })
                .skip(skip)
                .limit(safeLimit),
            Consultation.countDocuments(filter)
        ]);

        res.status(200).json({
            status: 'success',
            results: consultations.length,
            total,
            currentPage: safePage,
            totalPages: Math.ceil(total / safeLimit),
            data: { consultations }
        });
    } catch (err) {
        next(err);
    }
};

// ─── GET /api/consultations/doctor/:doctorId ──────────────────────────────────
exports.getDoctorConsultations = async (req, res, next) => {
    try {
        const { status, page = 1, limit = 10 } = req.query;
        if (!isValidObjectId(req.params.doctorId)) {
            return res.status(400).json({ status: 'error', message: 'Invalid doctor identifier.' });
        }
        if (!ensureDoctorOwnsResource(req, req.params.doctorId)) {
            return res.status(403).json({ status: 'error', message: 'You can only view your own consultations.' });
        }
        const filter = { doctor: req.params.doctorId };
        if (status) filter.status = status;

        const safePage = clampLimit(page, 1, 1000000);
        const safeLimit = clampLimit(limit, 10, 100);
        const skip = (safePage - 1) * safeLimit;
        const [consultations, total] = await Promise.all([
            Consultation.find(filter)
                .populate('patient', 'firstName lastName whatsappNumber dateOfBirth gender')
                .sort({ scheduledAt: 1 })
                .skip(skip)
                .limit(safeLimit),
            Consultation.countDocuments(filter)
        ]);

        res.status(200).json({
            status: 'success',
            results: consultations.length,
            total,
            currentPage: safePage,
            totalPages: Math.ceil(total / safeLimit),
            data: { consultations }
        });
    } catch (err) {
        next(err);
    }
};

// ─── PATCH /api/consultations/:id ─────────────────────────────────────────────
// Doctor updates notes, diagnosis, prescriptions, status
exports.updateConsultation = async (req, res, next) => {
    try {
        const allowed = [
            'status', 'doctorNotes', 'diagnosis',
            'prescriptions', 'followUpDate',
            'startedAt', 'endedAt', 'duration'
        ];
        const update = {};
        allowed.forEach(field => {
            if (req.body[field] !== undefined) update[field] = req.body[field];
        });
        if (!Object.keys(update).length) {
            return res.status(400).json({ status: 'error', message: 'No valid consultation fields were provided.' });
        }

        const consultation = await Consultation.findOneAndUpdate(
            { _id: req.params.id, doctor: req.doctor._id },
            update,
            { returnDocument: 'after', runValidators: true }
        );
        if (!consultation)
            return res.status(404).json({ status: 'error', message: 'Consultation not found.' });

        // ── When consultation is marked complete, free the doctor ─────────────
        if (update.status === 'completed') {
            await Doctor.findByIdAndUpdate(consultation.doctor, {
                isAvailableNow: true,
                activeConsultationId: null
            });

            // Notify the patient on WhatsApp that the session is closed
            const patient = await require('../models/Patient')
                .findById(consultation.patient).select('whatsappNumber firstName');

            if (patient?.whatsappNumber) {
                await require('../services/whatsappService').sendButtons(
                    patient.whatsappNumber,
                    `✅ *Your consultation has been completed.*\n\nThank you for using ABC Telemedica, ${patient.firstName}.\n\nWhat would you like to do next?`,
                    [
                        { id: 'consult', title: '🩺 New consultation' },
                        { id: 'history', title: '📋 My history' }
                    ]
                );
                // Return patient session to main menu
                await require('../models/WaSession').updateOne(
                    { phone: patient.whatsappNumber },
                    { step: 'MAIN_MENU', data: {} }
                );
            }
        }

        res.status(200).json({ status: 'success', data: { consultation } });
    } catch (err) {
        next(err);
    }
};

// ─── PATCH /api/consultations/:id/cancel ─────────────────────────────────────
exports.cancelConsultation = async (req, res, next) => {
    try {
        const { cancelledBy, cancellationReason } = req.body;

        const consultation = await Consultation.findById(req.params.id);
        if (!consultation)
            return res.status(404).json({ status: 'error', message: 'Consultation not found.' });
        if (!ensureDoctorOwnsResource(req, consultation.doctor)) {
            return res.status(403).json({ status: 'error', message: 'You can only cancel your own consultations.' });
        }

        if (['completed', 'cancelled'].includes(consultation.status))
            return res.status(400).json({
                status: 'error',
                message: `Cannot cancel a ${consultation.status} consultation.`
            });

        consultation.status = 'cancelled';
        consultation.cancelledBy = cancelledBy || 'doctor';
        consultation.cancellationReason = cancellationReason || null;
        await consultation.save();

        console.log(`Consultation ${req.params.id} cancelled by ${cancelledBy || 'doctor'}. Reason: ${cancellationReason || 'N/A'}`);

        res.status(200).json({
            status: 'success',
            message: 'Consultation cancelled.',
            // data: { consultation }
        });
    } catch (err) {
        next(err);
    }
};

exports.endConsultation = async (req, res) => {
    try {
        const { doctorNotes, diagnosis, prescriptions, followUpDate } = req.body;
        const consultation = await Consultation.findById(req.params.id).select('doctor');
        if (!consultation) {
            return res.status(404).json({ success: false, message: 'Consultation not found' });
        }
        if (!ensureDoctorOwnsResource(req, consultation.doctor)) {
            return res.status(403).json({ success: false, message: 'You can only end your own consultations.' });
        }

        const completedConsultation = await endConsultation(req.params.id, {
            doctorNotes,
            diagnosis,
            prescriptions,
            followUpDate: followUpDate ? new Date(followUpDate) : undefined
        });

        return res.status(200).json({
            success: true,
            message: 'Consultation ended. Patient has been sent a review prompt.',
            data: completedConsultation
        });

    } catch (err) {
        console.error('End consultation error:', err.message);
        const statusCode = err.message === 'Consultation not found' ? 404
            : err.message === 'Consultation is already completed' ? 400
                : 500;
        return res.status(statusCode).json({ success: false, message: err.message });
    }
};
