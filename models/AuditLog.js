// models/AuditLog.js
// Every read or write on patient data is recorded here.
// This satisfies NDPC Article 24 (data processing accountability).
const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
    // ── Who performed the action ──────────────────────────────────────────────
    performedBy: { type: mongoose.Schema.Types.ObjectId, refPath: 'performedByModel' },
    performedByModel: { type: String, enum: ['Admin', 'Doctor'], required: true },
    performedByName: { type: String, required: true },   // snapshot — survives deletion
    performedByRole: { type: String, required: true },   // 'admin' | 'superAdmin' | 'doctor'

    // ── What was accessed/changed ─────────────────────────────────────────────
    action: {
        type: String,
        enum: ['READ', 'CREATE', 'UPDATE', 'DELETE', 'EXPORT', 'LOGIN', 'LOGOUT', 'PAYOUT'],
        required: true
    },
    entity: { type: String, enum: ['Patient', 'Consultation', 'Doctor', 'Admin', 'Earning'], required: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null },
    entitySnapshot: { type: String, default: null },  // brief label: "John Doe (+2348012345678)"

    // ── Details ───────────────────────────────────────────────────────────────
    description: { type: String, required: true },
    // For UPDATE actions — what fields changed
    changesDiff: { type: mongoose.Schema.Types.Mixed, default: null },

    // ── Request metadata ──────────────────────────────────────────────────────
    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null },

    // ── Outcome ───────────────────────────────────────────────────────────────
    outcome: { type: String, enum: ['success', 'failure'], default: 'success' },
    errorMsg: { type: String, default: null },

}, { timestamps: true });

// Index for fast queries
AuditLogSchema.index({ performedBy: 1 });
AuditLogSchema.index({ entity: 1, entityId: 1 });
AuditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', AuditLogSchema);