const Doctor = require('../models/Doctor');
const jwt = require('jsonwebtoken');

const signToken = (id) =>
    jwt.sign({ id, role: 'doctor' }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    });


// ─── POST /api/doctors/register ───────────────────────────────────────────────
exports.register = async (req, res, next) => {
    try {
        const {
            firstName, lastName, email, phone, password,
            specialty, licenseNumber, licenseExpiry,
            yearsOfExperience, qualifications, bio,
            languages, consultationFee, whatsappNumber
        } = req.body;

        const existing = await Doctor.findOne({ $or: [{ email }, { phone }, { licenseNumber }] });
        if (existing) {
            return res.status(409).json({
                status: 'error',
                message: 'A doctor with this email, phone, or license number already exists.'
            });
        }

        const doctor = await Doctor.create({
            firstName, lastName, email, phone, password,
            specialty, licenseNumber, licenseExpiry,
            yearsOfExperience, qualifications, bio,
            languages, consultationFee, whatsappNumber
        });

        const token = signToken(doctor._id);

        res.status(201).json({
            status: 'success',
            message: 'Registration successful. Your account is pending verification.',
            token,
            data: { doctor: doctor.toPublicProfile() }
        });
    } catch (err) {
        next(err);
    }
};

// ─── POST /api/doctors/login ───────────────────────────────────────────────────
exports.login = async (req, res, next) => {
    try {
        const { email, password } = req.body;
        if (!email || !password)
            return res.status(400).json({ status: 'error', message: 'Email and password are required.' });

        const doctor = await Doctor.findOne({ email }).select('+password');
        if (!doctor || !(await doctor.comparePassword(password)))
            return res.status(401).json({ status: 'error', message: 'Invalid email or password.' });

        if (doctor.status === 'pending')
            return res.status(403).json({ status: 'error', message: 'Your account is awaiting verification.' });

        if (doctor.status === 'suspended' || doctor.status === 'rejected')
            return res.status(403).json({ status: 'error', message: `Your account has been ${doctor.status}.` });

        doctor.lastLogin = new Date();
        // await doctor.save({ validateBeforeSave: true });

        const token = signToken(doctor._id);

        res.status(200).json({
            status: 'success',
            token,
            data: { doctor: doctor.toPublicProfile() }
        });
    } catch (err) {
        next(err);
    }
};

// ─── GET /api/doctors ─────────────────────────────────────────────────────────
exports.getAllDoctors = async (req, res, next) => {
    try {
        const { specialty, available, minRating, maxFee, page = 1, limit = 10 } = req.query;

        const filter = { status: 'verified' };
        if (specialty) filter.specialty = specialty;
        if (available === 'true') filter.isAvailableNow = true;
        if (minRating) filter.rating = { $gte: Number(minRating) };
        if (maxFee) filter.consultationFee = { $lte: Number(maxFee) };

        const skip = (Number(page) - 1) * Number(limit);
        const [doctors, total] = await Promise.all([
            Doctor.find(filter)
                .select('-password -passwordResetToken -passwordResetExpires')
                .sort({ rating: -1, totalConsultations: -1 })
                .skip(skip)
                .limit(Number(limit)),
            Doctor.countDocuments(filter)
        ]);

        res.status(200).json({
            status: 'success',
            results: doctors.length,
            total,
            currentPage: Number(page),
            totalPages: Math.ceil(total / Number(limit)),
            data: { doctors: doctors.map(d => d.toPublicProfile()) }
        });
    } catch (err) {
        next(err);
    }
};

// ─── GET /api/doctors/:id ─────────────────────────────────────────────────────
exports.getDoctorById = async (req, res, next) => {
    try {
        const doctor = await Doctor.findById(req.params.id);
        if (!doctor || doctor.status !== 'verified')
            return res.status(404).json({ status: 'error', message: 'Doctor not found.' });

        res.status(200).json({
            status: 'success',
            data: { doctor: doctor.toPublicProfile() }
        });
    } catch (err) {
        next(err);
    }
};

// ─── PATCH /api/doctors/:id ───────────────────────────────────────────────────
// Doctor updates their own profile (protected route)
exports.updateProfile = async (req, res, next) => {
    try {
        const forbidden = ['password', 'email', 'licenseNumber', 'status', 'rating'];
        forbidden.forEach(f => delete req.body[f]);

        const doctor = await Doctor.findByIdAndUpdate(req.params.id, req.body, {
            returnDocument: 'after', runValidators: true
        });
        if (!doctor) return res.status(404).json({ status: 'error', message: 'Doctor not found.' });

        res.status(200).json({
            status: 'success',
            data: { doctor: doctor.toPublicProfile() }
        });
    } catch (err) {
        next(err);
    }
};

// ─── PATCH /api/doctors/:id/availability ─────────────────────────────────────
exports.updateAvailability = async (req, res, next) => {
    try {
        const { isAvailableNow, availabilitySchedule, consultationDuration } = req.body;

        const update = {};
        if (typeof isAvailableNow !== 'undefined') update.isAvailableNow = isAvailableNow;
        if (availabilitySchedule) update.availabilitySchedule = availabilitySchedule;
        if (consultationDuration) update.consultationDuration = consultationDuration;

        const doctor = await Doctor.findByIdAndUpdate(req.params.id, update, { returnDocument: 'after' });
        if (!doctor) return res.status(404).json({ status: 'error', message: 'Doctor not found.' });

        res.status(200).json({
            status: 'success',
            message: 'Availability updated.',
            data: {
                isAvailableNow: doctor.isAvailableNow,
                availabilitySchedule: doctor.availabilitySchedule,
                consultationDuration: doctor.consultationDuration
            }
        });
    } catch (err) {
        next(err);
    }
};

// ─── PATCH /api/doctors/:id/verify (Admin only) ───────────────────────────────
exports.verifyDoctor = async (req, res, next) => {
    try {
        const { action, rejectionReason } = req.body; // action: 'approve' | 'reject'

        const update =
            action === 'approve'
                ? { status: 'verified', licenseVerified: true, verifiedAt: new Date() }
                : { status: 'rejected', rejectionReason: rejectionReason || 'Not specified' };

        const doctor = await Doctor.findByIdAndUpdate(req.params.id, update, { returnDocument: 'after' });
        if (!doctor) return res.status(404).json({ status: 'error', message: 'Doctor not found.' });

        res.status(200).json({
            status: 'success',
            message: `Doctor has been ${action === 'approve' ? 'verified' : 'rejected'}.`,
            data: { doctor }
        });
    } catch (err) {
        next(err);
    }
};
