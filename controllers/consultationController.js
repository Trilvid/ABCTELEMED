const Consultation = require('../models/Consultation');
const Doctor = require('../models/Doctor');
const Patient = require('../models/Patient');

// ─── POST /api/consultations ──────────────────────────────────────────────────
exports.createConsultation = async (req, res, next) => {
    try {
        const { patientId, doctorId, scheduledAt, symptoms, channel } = req.body;

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
        const filter = { patient: req.params.patientId };
        if (status) filter.status = status;

        const skip = (Number(page) - 1) * Number(limit);
        const [consultations, total] = await Promise.all([
            Consultation.find(filter)
                .populate('doctor', 'firstName lastName specialty photo rating')
                .sort({ scheduledAt: -1 })
                .skip(skip)
                .limit(Number(limit)),
            Consultation.countDocuments(filter)
        ]);

        res.status(200).json({
            status: 'success',
            results: consultations.length,
            total,
            currentPage: Number(page),
            totalPages: Math.ceil(total / Number(limit)),
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
        const filter = { doctor: req.params.doctorId };
        if (status) filter.status = status;

        const skip = (Number(page) - 1) * Number(limit);
        const [consultations, total] = await Promise.all([
            Consultation.find(filter)
                .populate('patient', 'firstName lastName whatsappNumber dateOfBirth gender')
                .sort({ scheduledAt: 1 })
                .skip(skip)
                .limit(Number(limit)),
            Consultation.countDocuments(filter)
        ]);

        res.status(200).json({
            status: 'success',
            results: consultations.length,
            total,
            currentPage: Number(page),
            totalPages: Math.ceil(total / Number(limit)),
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

        const consultation = await Consultation.findByIdAndUpdate(
            req.params.id,
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

        if (['completed', 'cancelled'].includes(consultation.status))
            return res.status(400).json({
                status: 'error',
                message: `Cannot cancel a ${consultation.status} consultation.`
            });

        consultation.status = 'cancelled';
        consultation.cancelledBy = cancelledBy || 'system';
        consultation.cancellationReason = cancellationReason || null;
        await consultation.save();

        console.log(`Consultation ${req.params.id} cancelled by ${cancelledBy || 'system'}. Reason: ${cancellationReason || 'N/A'}`);

        res.status(200).json({
            status: 'success',
            message: 'Consultation cancelled.',
            // data: { consultation }
        });
    } catch (err) {
        next(err);
    }
};
