const Doctor = require('../models/Doctor');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

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
            yearsOfExperience, qualifications, bio, availabilitySchedule,
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
            languages, consultationFee, whatsappNumber, availabilitySchedule
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

// ─── POST /api/doctors/forgot-password ────
// Generates a reset token, saves its hash to the DB, and sends a reset email.
// Always responds with 200 to prevent email enumeration.
exports.forgotPassword = async (req, res, next) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ status: 'error', message: 'Email is required.' });

        const doctor = await require('../models/Doctor').findOne({ email: email.toLowerCase().trim() });

        if (doctor) {
            // Generate a random token
            const rawToken = crypto.randomBytes(32).toString('hex');
            // Store the HASH in the DB (never store raw token)
            const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

            doctor.passwordResetToken = hashedToken;
            doctor.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
            await doctor.save({ validateBeforeSave: false });

            // ── Build the reset URL ──
            const resetURL = `${process.env.CLIENT_URL || 'http://localhost:5173'}/auth/reset-password/${rawToken}`;

            // ── Send email via Resend (plug in when Resend is configured) ───────
            // For now: log to console. Replace this block when Resend is ready.

            // TODO: Replace console.log with Resend email send:
            const { Resend } = require('resend');
            const resend = new Resend(process.env.RESEND_API_KEY);
            console.log(`\n🔑 PASSWORD RESET LINK for ${doctor.email}:\n${resetURL}\n`);
            await resend.emails.send({
                from: 'ABC Telemedica <noreply@abctelemedica.ng>',
                to: doctor.email,
                subject: 'Reset your ABC Telemedica password',
                html: `
                    <p>Hello Dr. ${doctor.firstName},</p>
                    <p>You requested a password reset. Click the link below (expires in 1 hour):</p>
                    <a href="${resetURL}">${resetURL}</a>
                    <p>If you did not request this, you can ignore this email.</p>
                `
            });
        }

        // Always return 200 — don't reveal whether email exists (security)
        return res.status(200).json({
            status: 'success',
            message: 'If an account with that email exists, a reset link has been sent.'
        });
    } catch (err) {
        next(err);
    }
};

// ─── PATCH /api/doctors/reset-password/:token ───
// Validates the token (from email link) and updates the password.
exports.resetPassword = async (req, res, next) => {
    try {
        const { token } = req.params;
        const { password } = req.body;

        if (!token) return res.status(400).json({ status: 'error', message: 'Reset token is missing.' });
        if (!password || password.length < 6)
            return res.status(400).json({ status: 'error', message: 'Password must be at least 6 characters.' });

        // Hash the incoming raw token to compare with stored hash
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        const doctor = await require('../models/Doctor').findOne({
            passwordResetToken: hashedToken,
            passwordResetExpires: { $gt: new Date() }, // not expired
        }).select('+password');

        if (!doctor) {
            return res.status(400).json({
                status: 'error',
                message: 'This reset link is invalid or has expired. Please request a new one.'
            });
        }

        // Update password — the pre-save hook will hash it
        doctor.password = password;
        doctor.passwordResetToken = undefined;
        doctor.passwordResetExpires = undefined;
        await doctor.save();

        return res.status(200).json({
            status: 'success',
            message: 'Password updated successfully. Please log in with your new password.'
        });
    } catch (err) {
        next(err);
    }
};