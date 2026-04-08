// models/WithdrawalRequest.js
// Doctors request their 85% payout from here.
// Admin sees these in the Payments section and processes them.
const mongoose = require('mongoose');

const WithdrawalRequestSchema = new mongoose.Schema({
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
    // Earnings being withdrawn (can be multiple pending earnings)
    earningIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Earning' }],
    amount: { type: Number, required: true },    // total doctor amount being requested

    // Bank details at time of request (snapshot — doctor may change later)
    bankName: { type: String, required: true },
    accountNumber: { type: String, required: true },
    accountName: { type: String, required: true },

    status: {
        type: String,
        enum: ['pending', 'processing', 'paid', 'rejected'],
        default: 'pending'
    },

    // Admin response
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    processedAt: { type: Date, default: null },
    payoutReference: { type: String, default: null },
    adminNote: { type: String, default: null },
    rejectionReason: { type: String, default: null },

}, { timestamps: true });

WithdrawalRequestSchema.index({ doctor: 1, status: 1 });

module.exports = mongoose.model('WithdrawalRequest', WithdrawalRequestSchema);