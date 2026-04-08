// models/Earning.js
// Created automatically when a consultation payment is confirmed.
// Platform takes COMMISSION_RATE % and the doctor keeps the rest.
const mongoose = require('mongoose');

const COMMISSION_RATE = 15; // percent

const EarningSchema = new mongoose.Schema({
    // ── Parties ───────────────────────────────────────────────────────────────
    consultation: { type: mongoose.Schema.Types.ObjectId, ref: 'Consultation', required: true },
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },

    // ── Amounts (all in Naira) ────────────────────────────────────────────────
    grossAmount: { type: Number, required: true },           // full fee paid by patient
    commissionRate: { type: Number, default: COMMISSION_RATE }, // % taken by platform
    commissionAmount: { type: Number, required: true },           // grossAmount * rate / 100
    doctorAmount: { type: Number, required: true },           // grossAmount - commissionAmount

    // ── Payout status ─────────────────────────────────────────────────────────
    status: {
        type: String,
        enum: ['pending', 'processing', 'paid', 'cancelled'],
        default: 'pending'
    },

    // ── Payout details (filled when admin processes payout) ───────────────────
    paidAt: { type: Date, default: null },
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    payoutMethod: { type: String, default: null },   // e.g. 'bank_transfer'
    payoutReference: { type: String, default: null },   // bank transfer ref or Paystack transfer ID
    payoutNote: { type: String, default: null },

    // ── Doctor bank snapshot (at time of payout) ─────────────────────────────
    bankSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },

    // ── Source payment ────────────────────────────────────────────────────────
    paymentGateway: { type: String, default: 'flutterwave' },
    gatewayReference: { type: String, default: null },  // tx_ref from payment

}, { timestamps: true });

EarningSchema.index({ doctor: 1, status: 1 });
EarningSchema.index({ consultation: 1 });
EarningSchema.index({ status: 1 });

// Static helper to calculate split
EarningSchema.statics.calculateSplit = function (gross) {
    const commission = Math.round((gross * COMMISSION_RATE) / 100);
    return { gross, commission, doctorAmount: gross - commission, rate: COMMISSION_RATE };
};

module.exports = mongoose.model('Earning', EarningSchema);