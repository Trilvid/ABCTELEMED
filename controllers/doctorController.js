const Doctor = require('../models/Doctor');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Resend } = require('resend');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const allowedDoctorUpdateFields = [
    'firstName', 'lastName', 'phone', 'whatsappNumber', 'photo',
    'certificateUrl', 'licenseDocUrl', 'specialty', 'yearsOfExperience',
    'bio', 'languages', 'qualifications', 'licenseExpiry',
    'consultationFee', 'currency', 'consultationDuration', 'isOnCall',
    'bankDetails'
];
const clampLimit = (value, fallback = 10, max = 100) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, max);
};
const normalizeEmail = (value = '') => value.trim().toLowerCase();
const isOwnDoctorRecord = (req) => req.doctor && req.doctor._id.toString() === req.params.id;

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
            languages, consultationFee, whatsappNumber, photo, certificateUrl
        } = req.body;
        const normalizedEmail = normalizeEmail(email);

        if (!firstName || !lastName || !phone || !password || !specialty || !licenseNumber || !licenseExpiry) {
            return res.status(400).json({ status: 'error', message: 'Missing required registration fields.' });
        }
        if (!EMAIL_RE.test(normalizedEmail)) {
            return res.status(400).json({ status: 'error', message: 'A valid email address is required.' });
        }

        const existing = await Doctor.findOne({ $or: [{ email: normalizedEmail }, { phone }, { licenseNumber }] });
        if (existing) {
            return res.status(409).json({
                status: 'error',
                message: 'A doctor with this email, phone, or license number already exists.'
            });
        }
        if (String(password).length < 6) {
            return res.status(400).json({ status: 'error', message: 'Password must be at least 6 characters.' });
        }
        if (!Number.isFinite(Number(yearsOfExperience)) || Number(yearsOfExperience) < 0) {
            return res.status(400).json({ status: 'error', message: 'Years of experience must be a valid non-negative number.' });
        }

        const doctor = await Doctor.create({
            firstName, lastName, email: normalizedEmail, phone, password,
            specialty, licenseNumber, licenseExpiry,
            yearsOfExperience, qualifications, bio,
            languages, consultationFee, whatsappNumber, availabilitySchedule,
            photo, certificateUrl
        });

        const token = signToken(doctor._id);

        res.status(201).json({
            status: 'success',
            message: 'Registration successful. Your account is pending verification.',
            token,
            data: { doctor: doctor.toPublicProfile({ includeSensitive: true }) }
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
        if (!EMAIL_RE.test(normalizeEmail(email))) {
            return res.status(400).json({ status: 'error', message: 'A valid email address is required.' });
        }

        const doctor = await Doctor.findOne({ email: normalizeEmail(email) }).select('+password');
        if (!doctor || !(await doctor.comparePassword(password)))
            return res.status(401).json({ status: 'error', message: 'Invalid email or password.' });

        if (doctor.status === 'pending')
            return res.status(403).json({ status: 'error', message: 'Your account is awaiting verification.' });

        if (doctor.status === 'suspended' || doctor.status === 'rejected')
            return res.status(403).json({ status: 'error', message: `Your account has been ${doctor.status}.` });

        doctor.lastLogin = new Date();
        await doctor.save({ validateBeforeSave: false });

        const token = signToken(doctor._id);

        res.status(200).json({
            status: 'success',
            token,
            data: { doctor: doctor.toPublicProfile({ includeSensitive: true }) }
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

        const safePage = clampLimit(page, 1, 1000000);
        const safeLimit = clampLimit(limit, 10, 100);
        const skip = (safePage - 1) * safeLimit;
        const [doctors, total] = await Promise.all([
            Doctor.find(filter)
                .select('-password -passwordResetToken -passwordResetExpires')
                .sort({ rating: -1, totalConsultations: -1 })
                .skip(skip)
                .limit(safeLimit),
            Doctor.countDocuments(filter)
        ]);

        res.status(200).json({
            status: 'success',
            results: doctors.length,
            total,
            currentPage: safePage,
            totalPages: Math.ceil(total / safeLimit),
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
        if (!isOwnDoctorRecord(req)) {
            return res.status(403).json({ status: 'error', message: 'You can only update your own profile.' });
        }
        const update = {};
        allowedDoctorUpdateFields.forEach(field => {
            if (req.body[field] !== undefined) {
                update[field] = req.body[field];
            }
        });
        if (!Object.keys(update).length) {
            return res.status(400).json({ status: 'error', message: 'No valid profile fields were provided.' });
        }

        const doctor = await Doctor.findByIdAndUpdate(req.params.id, update, {
            returnDocument: 'after', runValidators: true
        });
        if (!doctor) return res.status(404).json({ status: 'error', message: 'Doctor not found.' });

        res.status(200).json({
            status: 'success',
            data: { doctor: doctor.toPublicProfile({ includeSensitive: true }) }
        });
    } catch (err) {
        next(err);
    }
};

// ─── PATCH /api/doctors/:id/availability ─────────────────────────────────────
exports.updateAvailability = async (req, res, next) => {
    try {
        if (!isOwnDoctorRecord(req)) {
            return res.status(403).json({ status: 'error', message: 'You can only update your own availability.' });
        }
        const { isAvailableNow, availabilitySchedule, consultationDuration } = req.body;

        const update = {};
        if (typeof isAvailableNow !== 'undefined') update.isAvailableNow = isAvailableNow;
        if (availabilitySchedule) update.availabilitySchedule = availabilitySchedule;
        if (consultationDuration) update.consultationDuration = consultationDuration;
        if (!Object.keys(update).length) {
            return res.status(400).json({ status: 'error', message: 'No valid availability fields were provided.' });
        }

        const doctor = await Doctor.findByIdAndUpdate(req.params.id, update, { returnDocument: 'after', runValidators: true });
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
        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({ status: 'error', message: 'Action must be either approve or reject.' });
        }

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
exports.forgotPassword = async (req, res, next) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ status: 'error', message: 'Email is required.' });
        if (!EMAIL_RE.test(normalizeEmail(email))) {
            return res.status(400).json({ status: 'error', message: 'A valid email address is required.' });
        }

        const Doctor = require('../models/Doctor');
        const doctor = await Doctor.findOne({ email: normalizeEmail(email) });

        if (doctor) {
            const rawToken = crypto.randomBytes(32).toString('hex');
            const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

            doctor.passwordResetToken = hashedToken;
            doctor.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000);
            await doctor.save({ validateBeforeSave: false });

            const resetURL = `${process.env.CLIENT_URL}/auth/reset-password/${rawToken}`;

            // ── Send email via Resend ──
            try {
                const resend = new Resend(process.env.RESEND_API_KEY);
                const { data, error } = await resend.emails.send({
                    from: `ABC Telemedica <${process.env.FROM_EMAIL || 'noreply@abctelemedica.ng'}>`,
                    to: doctor.email,
                    subject: 'Reset your ABC Telemedica password',
                    html: `
                        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f5f7fa;border-radius:16px;">
                            <div style="background:linear-gradient(135deg,#564DDF,#14B8A6);border-radius:12px;padding:24px;text-align:center;margin-bottom:28px;">
                                <h1 style="color:white;margin:0;font-size:1.4rem;">ABC Telemedica</h1>
                            </div>
                            <h2 style="color:#0F2940;margin:0 0 8px;">Password reset request</h2>
                            <p style="color:#4B5563;line-height:1.6;margin:0 0 24px;">
                                Hello Dr. ${doctor.firstName},<br><br>
                                We received a request to reset your password. Click the button below to set a new one. This link expires in <strong>1 hour</strong>.
                            </p>
                            <a href="${resetURL}" style="display:inline-block;padding:14px 28px;background:#564DDF;color:white;text-decoration:none;border-radius:10px;font-weight:700;font-size:0.95rem;">
                                Reset my password
                            </a>
                            <p style="color:#9CA3AF;font-size:0.78rem;margin:24px 0 0;line-height:1.6;">
                                If you didn't request this, you can safely ignore this email. Your password will not change.<br>
                                Or copy this link: <span style="color:#564DDF;">${resetURL}</span>
                            </p>
                        </div>
                    `,
                });
                if (error) {
                    console.error('Resend email error:', {
                        message: error.message,
                        name: error.name,
                        statusCode: error.statusCode,
                        email: doctor.email,
                        from: process.env.FROM_EMAIL || 'noreply@abctelemedica.ng',
                    });
                } else {
                    console.log(`Password reset email queued for ${doctor.email} (id: ${data?.id || 'unknown'})`);
                }
            } catch (emailErr) {
                console.error('Resend email exception:', emailErr.message);
                // Don't fail the request — token is saved, user can try again
            }
        }

        // Always 200 — never leak whether email exists
        return res.status(200).json({
            status: 'success',
            message: 'If an account with that email exists, a reset link has been sent.',
        });
    } catch (err) { next(err); }
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
