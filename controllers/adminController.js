// controllers/adminController.js
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const Admin = require('../models/Admin');
const Doctor = require('../models/Doctor');
const Patient = require('../models/Patient');
const Consultation = require('../models/Consultation');
const Earning = require('../models/Earning');
const AuditLog = require('../models/AuditLog');

const signToken = (id, role) =>
    jwt.sign({ id, role }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '12h'
    });

// ── Audit log helper ──────────────────────────────────────────────────────────
const audit = (req, opts) => {
    const actor = req.admin;
    AuditLog.create({
        performedBy: actor._id,
        performedByModel: 'Admin',
        performedByName: `${actor.firstName} ${actor.lastName}`,
        performedByRole: actor.role,
        ipAddress: req.ip || req.headers['x-forwarded-for'],
        userAgent: req.headers['user-agent'],
        outcome: 'success',
        ...opts,
    }).catch(err => console.error('Audit log error:', err.message));
};

// ════════════════════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════════════════════

// POST /api/admin/login
exports.login = async (req, res, next) => {
    try {
        const { email, password } = req.body;
        if (!email || !password)
            return res.status(400).json({ status: 'error', message: 'Email and password required.' });

        const admin = await Admin.findOne({ email: email.toLowerCase().trim() }).select('+password');
        if (!admin || !(await admin.comparePassword(password)))
            return res.status(401).json({ status: 'error', message: 'Invalid email or password.' });

        if (!admin.isActive)
            return res.status(403).json({ status: 'error', message: 'This admin account has been deactivated.' });

        admin.lastLogin = new Date();
        await admin.save({ validateBeforeSave: false });

        AuditLog.create({
            performedBy: admin._id, performedByModel: 'Admin',
            performedByName: `${admin.firstName} ${admin.lastName}`,
            performedByRole: admin.role,
            action: 'LOGIN', entity: 'Admin', entityId: admin._id,
            description: `Admin logged in: ${admin.email}`,
            ipAddress: req.ip || req.headers['x-forwarded-for'],
            userAgent: req.headers['user-agent'],
        }).catch(() => { });

        const token = signToken(admin._id, admin.role);
        const { password: _, ...adminData } = admin.toObject();

        res.status(200).json({ status: 'success', token, data: { admin: adminData } });
    } catch (err) { next(err); }
};

// POST /api/admin/create  (superAdmin only)
exports.createAdmin = async (req, res, next) => {
    try {
        const { firstName, lastName, email, password, role, permissions } = req.body;

        if (role === 'superAdmin' && req.admin.role !== 'superAdmin')
            return res.status(403).json({ status: 'error', message: 'Only a superAdmin can create another superAdmin.' });

        const existing = await Admin.findOne({ email: email?.toLowerCase().trim() });
        if (existing)
            return res.status(409).json({ status: 'error', message: 'An admin with this email already exists.' });

        const newAdmin = await Admin.create({
            firstName, lastName, email, password,
            role: role || 'admin',
            permissions: permissions || {},
            createdBy: req.admin._id,
        });

        audit(req, {
            action: 'CREATE', entity: 'Admin', entityId: newAdmin._id,
            description: `Created admin account: ${newAdmin.email} (${newAdmin.role})`,
        });

        const { password: _, ...data } = newAdmin.toObject();
        res.status(201).json({ status: 'success', data: { admin: data } });
    } catch (err) { next(err); }
};

// GET /api/admin/me
exports.getMe = async (req, res) => {
    const { password: _, ...data } = req.admin.toObject();
    res.status(200).json({ status: 'success', data: { admin: data } });
};

// ════════════════════════════════════════════════════════════════════════════
// PLATFORM STATS
// ════════════════════════════════════════════════════════════════════════════

// GET /api/admin/stats
exports.getStats = async (req, res, next) => {
    try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const [
            totalDoctors, pendingDoctors, verifiedDoctors, suspendedDoctors,
            totalPatients, totalConsultations, completedConsultations,
            monthlyConsultations, pendingEarnings, totalEarnings,
            monthlyRevenue, recentConsultations,
        ] = await Promise.all([
            Doctor.countDocuments(),
            Doctor.countDocuments({ status: 'pending' }),
            Doctor.countDocuments({ status: 'verified' }),
            Doctor.countDocuments({ status: 'suspended' }),
            Patient.countDocuments(),
            Consultation.countDocuments(),
            Consultation.countDocuments({ status: 'completed' }),
            Consultation.countDocuments({ createdAt: { $gte: startOfMonth } }),
            Earning.countDocuments({ status: 'pending' }),
            Earning.aggregate([{ $group: { _id: null, total: { $sum: '$grossAmount' }, commission: { $sum: '$commissionAmount' }, doctorPayout: { $sum: '$doctorAmount' } } }]),
            Earning.aggregate([{ $match: { createdAt: { $gte: startOfMonth } } }, { $group: { _id: null, total: { $sum: '$grossAmount' }, commission: { $sum: '$commissionAmount' } } }]),
            Consultation.find({ status: 'confirmed' }).populate('patient', 'firstName lastName').populate('doctor', 'firstName lastName specialty').sort({ scheduledAt: 1 }).limit(5),
        ]);

        const earningTotals = totalEarnings[0] || { total: 0, commission: 0, doctorPayout: 0 };
        const monthlyTotals = monthlyRevenue[0] || { total: 0, commission: 0 };

        res.status(200).json({
            status: 'success',
            data: {
                doctors: { total: totalDoctors, pending: pendingDoctors, verified: verifiedDoctors, suspended: suspendedDoctors },
                patients: { total: totalPatients },
                consultations: { total: totalConsultations, completed: completedConsultations, thisMonth: monthlyConsultations, pending: pendingEarnings },
                revenue: {
                    allTime: { gross: earningTotals.total, commission: earningTotals.commission, doctorPayouts: earningTotals.doctorPayout },
                    thisMonth: { gross: monthlyTotals.total, commission: monthlyTotals.commission },
                },
                recentConsultations,
            }
        });
    } catch (err) { next(err); }
};

// ════════════════════════════════════════════════════════════════════════════
// DOCTORS MANAGEMENT
// ════════════════════════════════════════════════════════════════════════════

// GET /api/admin/doctors
exports.getDoctors = async (req, res, next) => {
    try {
        const { status, specialty, search, page = 1, limit = 20 } = req.query;
        const filter = {};
        if (status) filter.status = status;
        if (specialty) filter.specialty = specialty;
        if (search) {
            const rx = new RegExp(search, 'i');
            filter.$or = [{ firstName: rx }, { lastName: rx }, { email: rx }, { licenseNumber: rx }];
        }
        const skip = (Number(page) - 1) * Number(limit);
        const [doctors, total] = await Promise.all([
            Doctor.find(filter).select('-password -passwordResetToken -passwordResetExpires').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
            Doctor.countDocuments(filter),
        ]);
        res.status(200).json({ status: 'success', total, currentPage: Number(page), totalPages: Math.ceil(total / Number(limit)), data: { doctors } });
    } catch (err) { next(err); }
};

// GET /api/admin/doctors/:id
exports.getDoctorDetail = async (req, res, next) => {
    try {
        const doctor = await Doctor.findById(req.params.id).select('-password -passwordResetToken -passwordResetExpires');
        if (!doctor) return res.status(404).json({ status: 'error', message: 'Doctor not found.' });

        const [consultations, earnings] = await Promise.all([
            Consultation.find({ doctor: doctor._id }).populate('patient', 'firstName lastName').sort({ scheduledAt: -1 }).limit(10),
            Earning.find({ doctor: doctor._id }).sort({ createdAt: -1 }).limit(10),
        ]);

        audit(req, {
            action: 'READ', entity: 'Doctor', entityId: doctor._id,
            entitySnapshot: `Dr. ${doctor.firstName} ${doctor.lastName}`,
            description: `Viewed doctor profile: ${doctor.email}`,
        });

        res.status(200).json({ status: 'success', data: { doctor, consultations, earnings } });
    } catch (err) { next(err); }
};

// PATCH /api/admin/doctors/:id/verify
exports.verifyDoctor = async (req, res, next) => {
    try {
        const { action, rejectionReason } = req.body;
        const update = action === 'approve'
            ? { status: 'verified', licenseVerified: true, verifiedAt: new Date(), verifiedBy: req.admin._id, rejectionReason: null }
            : { status: 'rejected', licenseVerified: false, rejectionReason: rejectionReason || 'Not specified' };

        const doctor = await Doctor.findByIdAndUpdate(req.params.id, update, { returnDocument: 'after' });
        if (!doctor) return res.status(404).json({ status: 'error', message: 'Doctor not found.' });

        audit(req, {
            action: 'UPDATE', entity: 'Doctor', entityId: doctor._id,
            entitySnapshot: `Dr. ${doctor.firstName} ${doctor.lastName}`,
            description: `Doctor ${action === 'approve' ? 'verified' : 'rejected'}: ${doctor.email}. ${rejectionReason ? 'Reason: ' + rejectionReason : ''}`,
        });

        res.status(200).json({ status: 'success', message: `Doctor ${action === 'approve' ? 'verified' : 'rejected'}.`, data: { doctor } });
    } catch (err) { next(err); }
};

// PATCH /api/admin/doctors/:id/status
exports.updateDoctorStatus = async (req, res, next) => {
    try {
        const { status, reason } = req.body;
        const validStatuses = ['verified', 'suspended', 'rejected', 'pending'];
        if (!validStatuses.includes(status))
            return res.status(400).json({ status: 'error', message: 'Invalid status.' });

        const doctor = await Doctor.findByIdAndUpdate(req.params.id, { status, rejectionReason: reason || null }, { returnDocument: 'after' });
        if (!doctor) return res.status(404).json({ status: 'error', message: 'Doctor not found.' });

        audit(req, {
            action: 'UPDATE', entity: 'Doctor', entityId: doctor._id,
            entitySnapshot: `Dr. ${doctor.firstName} ${doctor.lastName}`,
            description: `Doctor status changed to "${status}": ${doctor.email}. ${reason ? 'Reason: ' + reason : ''}`,
            changesDiff: { status },
        });

        res.status(200).json({ status: 'success', data: { doctor } });
    } catch (err) { next(err); }
};

// ════════════════════════════════════════════════════════════════════════════
// PATIENTS MANAGEMENT
// ════════════════════════════════════════════════════════════════════════════

// GET /api/admin/patients
exports.getPatients = async (req, res, next) => {
    try {
        const { search, plan, page = 1, limit = 20 } = req.query;
        const filter = {};
        if (plan) filter.plan = plan;
        if (search) {
            const rx = new RegExp(search, 'i');
            filter.$or = [{ firstName: rx }, { lastName: rx }, { whatsappNumber: rx }];
        }
        const skip = (Number(page) - 1) * Number(limit);
        const [patients, total] = await Promise.all([
            Patient.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
            Patient.countDocuments(filter),
        ]);

        audit(req, {
            action: 'READ', entity: 'Patient',
            description: `Listed patients (page ${page}, filter: ${JSON.stringify({ search, plan })})`,
        });

        res.status(200).json({ status: 'success', total, currentPage: Number(page), totalPages: Math.ceil(total / Number(limit)), data: { patients } });
    } catch (err) { next(err); }
};

// GET /api/admin/patients/:id
exports.getPatientDetail = async (req, res, next) => {
    try {
        const patient = await Patient.findById(req.params.id);
        if (!patient) return res.status(404).json({ status: 'error', message: 'Patient not found.' });

        const consultations = await Consultation.find({ patient: patient._id })
            .populate('doctor', 'firstName lastName specialty')
            .sort({ scheduledAt: -1 });

        audit(req, {
            action: 'READ', entity: 'Patient', entityId: patient._id,
            entitySnapshot: `${patient.firstName || 'Unknown'} ${patient.lastName || ''} (+${patient.whatsappNumber})`,
            description: `Viewed patient record: ${patient.whatsappNumber}`,
        });

        res.status(200).json({ status: 'success', data: { patient, consultations } });
    } catch (err) { next(err); }
};

// PATCH /api/admin/patients/:id
exports.updatePatient = async (req, res, next) => {
    try {
        const before = await Patient.findById(req.params.id).lean();
        if (!before) return res.status(404).json({ status: 'error', message: 'Patient not found.' });

        const allowed = ['plan', 'planExpiresAt', 'isProfileComplete'];
        const update = {};
        allowed.forEach(f => { if (req.body[f] !== undefined) update[f] = req.body[f]; });

        const patient = await Patient.findByIdAndUpdate(req.params.id, update, { returnDocument: 'after', runValidators: true });

        // Diff only the changed fields
        const diff = {};
        Object.keys(update).forEach(k => { diff[k] = { from: before[k], to: update[k] }; });

        audit(req, {
            action: 'UPDATE', entity: 'Patient', entityId: patient._id,
            entitySnapshot: `${patient.firstName || 'Unknown'} (+${patient.whatsappNumber})`,
            description: `Updated patient fields: ${Object.keys(update).join(', ')}`,
            changesDiff: diff,
        });

        res.status(200).json({ status: 'success', data: { patient } });
    } catch (err) { next(err); }
};

// ════════════════════════════════════════════════════════════════════════════
// CONSULTATIONS
// ════════════════════════════════════════════════════════════════════════════

// GET /api/admin/consultations
exports.getConsultations = async (req, res, next) => {
    try {
        const { status, doctorId, patientId, page = 1, limit = 20 } = req.query;
        const filter = {};
        if (status) filter.status = status;
        if (doctorId) filter.doctor = doctorId;
        if (patientId) filter.patient = patientId;
        const skip = (Number(page) - 1) * Number(limit);
        const [consultations, total] = await Promise.all([
            Consultation.find(filter)
                .populate('patient', 'firstName lastName whatsappNumber')
                .populate('doctor', 'firstName lastName specialty')
                .sort({ scheduledAt: -1 }).skip(skip).limit(Number(limit)),
            Consultation.countDocuments(filter),
        ]);
        res.status(200).json({ status: 'success', total, currentPage: Number(page), totalPages: Math.ceil(total / Number(limit)), data: { consultations } });
    } catch (err) { next(err); }
};

// GET /api/admin/consultations/:id
exports.getConsultationDetail = async (req, res, next) => {
    try {
        const consultation = await Consultation.findById(req.params.id)
            .populate('patient', 'firstName lastName whatsappNumber gender dateOfBirth location plan')
            .populate('doctor', 'firstName lastName specialty email phone');
        if (!consultation) return res.status(404).json({ status: 'error', message: 'Consultation not found.' });

        audit(req, {
            action: 'READ', entity: 'Consultation', entityId: consultation._id,
            entitySnapshot: `Consultation for ${consultation.patient?.firstName}`,
            description: `Viewed consultation: ${consultation._id}`,
        });

        res.status(200).json({ status: 'success', data: { consultation } });
    } catch (err) { next(err); }
};

// ════════════════════════════════════════════════════════════════════════════
// EARNINGS & PAYOUTS
// ════════════════════════════════════════════════════════════════════════════

// GET /api/admin/earnings
exports.getEarnings = async (req, res, next) => {
    try {
        const { status, doctorId, page = 1, limit = 20 } = req.query;
        const filter = {};
        if (status) filter.status = status;
        if (doctorId) filter.doctor = doctorId;
        const skip = (Number(page) - 1) * Number(limit);
        const [earnings, total, summary] = await Promise.all([
            Earning.find(filter)
                .populate('doctor', 'firstName lastName specialty email')
                .populate('patient', 'firstName lastName whatsappNumber')
                .populate('consultation', 'scheduledAt status')
                .sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
            Earning.countDocuments(filter),
            Earning.aggregate([
                { $match: filter },
                { $group: { _id: '$status', count: { $sum: 1 }, gross: { $sum: '$grossAmount' }, commission: { $sum: '$commissionAmount' }, doctorTotal: { $sum: '$doctorAmount' } } }
            ]),
        ]);
        res.status(200).json({ status: 'success', total, currentPage: Number(page), totalPages: Math.ceil(total / Number(limit)), data: { earnings, summary } });
    } catch (err) { next(err); }
};

// GET /api/admin/earnings/doctor/:doctorId — earnings breakdown for one doctor
exports.getDoctorEarnings = async (req, res, next) => {
    try {
        const { doctorId } = req.params;
        const [doctor, earnings, agg] = await Promise.all([
            Doctor.findById(doctorId).select('firstName lastName email specialty phone'),
            Earning.find({ doctor: doctorId }).populate('consultation', 'scheduledAt').sort({ createdAt: -1 }),
            Earning.aggregate([
                { $match: { doctor: require('mongoose').Types.ObjectId(doctorId) } },
                { $group: { _id: '$status', total: { $sum: '$doctorAmount' }, count: { $sum: 1 } } }
            ]),
        ]);
        if (!doctor) return res.status(404).json({ status: 'error', message: 'Doctor not found.' });
        res.status(200).json({ status: 'success', data: { doctor, earnings, summary: agg } });
    } catch (err) { next(err); }
};

// PATCH /api/admin/earnings/:id/payout — process a single payout
exports.processPayout = async (req, res, next) => {
    try {
        const { payoutMethod, payoutReference, payoutNote, bankSnapshot } = req.body;
        const earning = await Earning.findById(req.params.id).populate('doctor', 'firstName lastName email');
        if (!earning) return res.status(404).json({ status: 'error', message: 'Earning record not found.' });
        if (earning.status === 'paid')
            return res.status(400).json({ status: 'error', message: 'This earning has already been paid out.' });
        if (earning.status === 'cancelled')
            return res.status(400).json({ status: 'error', message: 'Cannot pay out a cancelled earning.' });

        earning.status = 'paid';
        earning.paidAt = new Date();
        earning.paidBy = req.admin._id;
        earning.payoutMethod = payoutMethod || 'bank_transfer';
        earning.payoutReference = payoutReference || null;
        earning.payoutNote = payoutNote || null;
        earning.bankSnapshot = bankSnapshot || null;
        await earning.save();

        audit(req, {
            action: 'PAYOUT', entity: 'Earning', entityId: earning._id,
            entitySnapshot: `Dr. ${earning.doctor?.firstName} ${earning.doctor?.lastName}`,
            description: `Payout processed: ₦${earning.doctorAmount.toLocaleString()} to Dr. ${earning.doctor?.lastName}. Ref: ${payoutReference || 'none'}`,
        });

        res.status(200).json({ status: 'success', message: 'Payout marked as paid.', data: { earning } });
    } catch (err) { next(err); }
};

// POST /api/admin/earnings/bulk-payout — mark multiple pending earnings as paid
exports.bulkPayout = async (req, res, next) => {
    try {
        const { earningIds, payoutMethod, payoutReference, payoutNote } = req.body;
        if (!Array.isArray(earningIds) || !earningIds.length)
            return res.status(400).json({ status: 'error', message: 'Provide an array of earning IDs.' });

        const result = await Earning.updateMany(
            { _id: { $in: earningIds }, status: 'pending' },
            { status: 'paid', paidAt: new Date(), paidBy: req.admin._id, payoutMethod, payoutReference, payoutNote }
        );

        audit(req, {
            action: 'PAYOUT', entity: 'Earning',
            description: `Bulk payout: ${result.modifiedCount} earnings marked as paid. Method: ${payoutMethod}. Ref: ${payoutReference || 'none'}`,
        });

        res.status(200).json({ status: 'success', message: `${result.modifiedCount} payouts processed.` });
    } catch (err) { next(err); }
};

// ════════════════════════════════════════════════════════════════════════════
// AUDIT LOGS
// ════════════════════════════════════════════════════════════════════════════

// GET /api/admin/audit-logs
exports.getAuditLogs = async (req, res, next) => {
    try {
        const { action, entity, performedByRole, page = 1, limit = 30 } = req.query;
        const filter = {};
        if (action) filter.action = action;
        if (entity) filter.entity = entity;
        if (performedByRole) filter.performedByRole = performedByRole;

        const skip = (Number(page) - 1) * Number(limit);
        const [logs, total] = await Promise.all([
            AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
            AuditLog.countDocuments(filter),
        ]);
        res.status(200).json({ status: 'success', total, currentPage: Number(page), totalPages: Math.ceil(total / Number(limit)), data: { logs } });
    } catch (err) { next(err); }
};

// ════════════════════════════════════════════════════════════════════════════
// ADMIN MANAGEMENT (superAdmin only)
// ════════════════════════════════════════════════════════════════════════════

// GET /api/admin/admins
exports.getAdmins = async (req, res, next) => {
    try {
        const admins = await Admin.find().populate('createdBy', 'firstName lastName').sort({ createdAt: -1 });
        res.status(200).json({ status: 'success', data: { admins } });
    } catch (err) { next(err); }
};

// PATCH /api/admin/admins/:id/status
exports.toggleAdminStatus = async (req, res, next) => {
    try {
        if (req.params.id === req.admin._id.toString())
            return res.status(400).json({ status: 'error', message: 'You cannot deactivate yourself.' });

        const admin = await Admin.findById(req.params.id);
        if (!admin) return res.status(404).json({ status: 'error', message: 'Admin not found.' });

        admin.isActive = !admin.isActive;
        await admin.save({ validateBeforeSave: false });

        audit(req, {
            action: 'UPDATE', entity: 'Admin', entityId: admin._id,
            description: `Admin account ${admin.isActive ? 'activated' : 'deactivated'}: ${admin.email}`,
            changesDiff: { isActive: admin.isActive },
        });

        res.status(200).json({ status: 'success', message: `Admin ${admin.isActive ? 'activated' : 'deactivated'}.`, data: { admin } });
    } catch (err) { next(err); }
};

// DELETE /api/admin/admins/:id  (superAdmin only)
exports.deleteAdmin = async (req, res, next) => {
    try {
        if (req.params.id === req.admin._id.toString())
            return res.status(400).json({ status: 'error', message: 'You cannot delete yourself.' });

        const admin = await Admin.findByIdAndDelete(req.params.id);
        if (!admin) return res.status(404).json({ status: 'error', message: 'Admin not found.' });

        audit(req, {
            action: 'DELETE', entity: 'Admin', entityId: admin._id,
            description: `Admin account permanently deleted: ${admin.email}`,
        });

        res.status(200).json({ status: 'success', message: 'Admin deleted.' });
    } catch (err) { next(err); }
};