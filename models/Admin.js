// models/Admin.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const AdminSchema = new mongoose.Schema({
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    role: {
        type: String,
        enum: ['admin', 'superAdmin'],
        default: 'admin'
    },
    // Which superAdmin created this account
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    isActive: { type: Boolean, default: true },
    lastLogin: { type: Date, default: null },

    // Granular permissions (superAdmin bypasses all of these)
    permissions: {
        viewPatients: { type: Boolean, default: true },
        editPatients: { type: Boolean, default: false },
        verifyDoctors: { type: Boolean, default: true },
        suspendDoctors: { type: Boolean, default: false },
        processPayouts: { type: Boolean, default: false },
        viewAuditLogs: { type: Boolean, default: true },
        manageAdmins: { type: Boolean, default: false },
    },

    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
}, { timestamps: true });

AdminSchema.virtual('fullName').get(function () {
    return `${this.firstName} ${this.lastName}`;
});

AdminSchema.pre('save', async function () {
    if (!this.isModified('password')) return;
    this.password = await bcrypt.hash(this.password, 12);
});

AdminSchema.methods.comparePassword = async function (candidate) {
    return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('Admin', AdminSchema);