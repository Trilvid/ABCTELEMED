
const WithdrawalRequest = require('../models/WithdrawalRequest');
const Earning = require('../models/Earning');
const AuditLog = require('../models/AuditLog');

const ACCOUNT_NUMBER_RE = /^\d{10}$/;
const clampLimit = (value, fallback = 20, max = 100) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, max);
};

// POST /api/doctors/withdraw  — doctor requests withdrawal
exports.requestWithdrawal = async (req, res, next) => {
    try {
        const doctorId = req.doctor._id;
        const { bankName, accountNumber, accountName } = req.body;

        if (!bankName || !accountNumber || !accountName)
            return res.status(400).json({ status: 'error', message: 'Bank name, account number and account name are required.' });
        if (!ACCOUNT_NUMBER_RE.test(String(accountNumber).trim())) {
            return res.status(400).json({ status: 'error', message: 'Account number must be a valid 10-digit value.' });
        }

        // Find all pending earnings for this doctor
        const pendingEarnings = await Earning.find({ doctor: doctorId, status: 'pending' });
        if (!pendingEarnings.length)
            return res.status(400).json({ status: 'error', message: 'No pending earnings to withdraw.' });

        const totalAmount = pendingEarnings.reduce((sum, e) => sum + e.doctorAmount, 0);

        // Check there is no pending withdrawal already
        const existing = await WithdrawalRequest.findOne({ doctor: doctorId, status: { $in: ['pending', 'processing'] } });
        if (existing)
            return res.status(409).json({ status: 'error', message: 'You already have a pending withdrawal request. Please wait for it to be processed.' });

        const withdrawal = await WithdrawalRequest.create({
            doctor: doctorId,
            earningIds: pendingEarnings.map(e => e._id),
            amount: totalAmount,
            bankName,
            accountNumber,
            accountName,
        });

        // Mark earnings as 'processing'
        await Earning.updateMany({ _id: { $in: pendingEarnings.map(e => e._id) } }, { status: 'processing' });

        res.status(201).json({ status: 'success', message: 'Withdrawal request submitted. Admin will process it shortly.', data: { withdrawal } });
    } catch (err) { next(err); }
};

// GET /api/doctors/withdrawals  — doctor sees their withdrawal history
exports.getMyWithdrawals = async (req, res, next) => {
    try {
        const withdrawals = await WithdrawalRequest.find({ doctor: req.doctor._id }).sort({ createdAt: -1 });
        res.status(200).json({ status: 'success', data: { withdrawals } });
    } catch (err) { next(err); }
};

// GET /api/doctors/earnings/summary  — doctor sees their earnings breakdown
exports.getEarningsSummary = async (req, res, next) => {
    try {
        const doctorId = req.doctor._id;
        const [earnings, pending, processing, paid] = await Promise.all([
            Earning.find({ doctor: doctorId }).sort({ createdAt: -1 }).limit(20),
            Earning.aggregate([{ $match: { doctor: doctorId, status: 'pending' } }, { $group: { _id: null, total: { $sum: '$doctorAmount' }, count: { $sum: 1 } } }]),
            Earning.aggregate([{ $match: { doctor: doctorId, status: 'processing' } }, { $group: { _id: null, total: { $sum: '$doctorAmount' }, count: { $sum: 1 } } }]),
            Earning.aggregate([{ $match: { doctor: doctorId, status: 'paid' } }, { $group: { _id: null, total: { $sum: '$doctorAmount' }, count: { $sum: 1 } } }]),
        ]);
        res.status(200).json({
            status: 'success',
            data: {
                earnings,
                summary: {
                    pending: pending[0] || { total: 0, count: 0 },
                    processing: processing[0] || { total: 0, count: 0 },
                    paid: paid[0] || { total: 0, count: 0 },
                }
            }
        });
    } catch (err) { next(err); }
};


// GET /api/admin/withdrawals
exports.adminGetWithdrawals = async (req, res, next) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const filter = {};
        if (status) filter.status = status;
        const safePage = clampLimit(page, 1, 1000000);
        const safeLimit = clampLimit(limit, 20, 100);
        const skip = (safePage - 1) * safeLimit;
        const [withdrawals, total] = await Promise.all([
            WithdrawalRequest.find(filter)
                .populate('doctor', 'firstName lastName email phone bankDetails')
                .sort({ createdAt: -1 }).skip(skip).limit(safeLimit),
            WithdrawalRequest.countDocuments(filter),
        ]);
        res.status(200).json({ status: 'success', total, currentPage: safePage, totalPages: Math.ceil(total / safeLimit), data: { withdrawals } });
    } catch (err) { next(err); }
};

// PATCH /api/admin/withdrawals/:id — admin processes or rejects
exports.adminProcessWithdrawal = async (req, res, next) => {
    try {
        const { action, payoutReference, adminNote, rejectionReason } = req.body;
        if (!['pay', 'reject'].includes(action)) {
            return res.status(400).json({ status: 'error', message: 'Action must be either pay or reject.' });
        }
        const withdrawal = await WithdrawalRequest.findById(req.params.id).populate('doctor', 'firstName lastName');
        if (!withdrawal) return res.status(404).json({ status: 'error', message: 'Withdrawal request not found.' });
        if (withdrawal.status === 'paid' || withdrawal.status === 'rejected')
            return res.status(400).json({ status: 'error', message: `This request is already ${withdrawal.status}.` });

        if (action === 'pay') {
            withdrawal.status = 'paid';
            withdrawal.processedAt = new Date();
            withdrawal.processedBy = req.admin._id;
            withdrawal.payoutReference = payoutReference || null;
            withdrawal.adminNote = adminNote || null;
            // Mark all associated earnings as paid
            await Earning.updateMany({ _id: { $in: withdrawal.earningIds } }, { status: 'paid', paidAt: new Date(), paidBy: req.admin._id, payoutReference });
        } else {
            withdrawal.status = 'rejected';
            withdrawal.processedAt = new Date();
            withdrawal.processedBy = req.admin._id;
            withdrawal.rejectionReason = rejectionReason || 'No reason provided';
            // Revert earnings to pending
            await Earning.updateMany({ _id: { $in: withdrawal.earningIds } }, { status: 'pending' });
        }

        await withdrawal.save();

        AuditLog.create({
            performedBy: req.admin._id, performedByModel: 'Admin',
            performedByName: `${req.admin.firstName} ${req.admin.lastName}`,
            performedByRole: req.admin.role,
            action: 'PAYOUT', entity: 'Earning',
            description: `Withdrawal ${action === 'pay' ? 'paid' : 'rejected'} for Dr. ${withdrawal.doctor?.lastName}. Amount: ₦${withdrawal.amount.toLocaleString()}. Ref: ${payoutReference || 'none'}`,
            ipAddress: req.ip,
        }).catch(() => { });

        res.status(200).json({ status: 'success', message: `Withdrawal ${action === 'pay' ? 'processed' : 'rejected'}.`, data: { withdrawal } });
    } catch (err) { next(err); }
};
