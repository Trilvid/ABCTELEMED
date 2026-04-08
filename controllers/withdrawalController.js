
const WithdrawalRequest = require('../models/WithdrawalRequest');
const Earning = require('../models/Earning');
const AuditLog = require('../models/AuditLog');

// POST /api/doctors/withdraw  — doctor requests withdrawal
exports.requestWithdrawal = async (req, res, next) => {
    try {
        const doctorId = req.doctor._id;
        const { bankName, accountNumber, accountName } = req.body;

        if (!bankName || !accountNumber || !accountName)
            return res.status(400).json({ status: 'error', message: 'Bank name, account number and account name are required.' });

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