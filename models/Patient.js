const mongoose = require('mongoose');

const medicalHistorySchema = new mongoose.Schema({
    condition: { type: String, required: true },
    diagnosedYear: { type: Number },
    onMedication: { type: Boolean, default: false },
    notes: { type: String }
}, { _id: false });

const allergySchema = new mongoose.Schema({
    allergen: { type: String, required: true },
    reaction: { type: String }
}, { _id: false });

const PatientSchema = new mongoose.Schema({
    // --- Identity ---
    whatsappNumber: { type: String, required: true, unique: true, trim: true },
    firstName: { type: String, trim: true, default: null },
    lastName: { type: String, trim: true, default: null },
    dateOfBirth: { type: Date, default: null },
    gender: {
        type: String,
        enum: ['male', 'female', 'prefer_not_to_say', null],
        default: null
    },
    location: {
        country: { type: String, default: 'Nigeria' },
        state: { type: String, default: null }
    },

    // --- Health Profile ---
    bloodGroup: {
        type: String,
        enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', null],
        default: null
    },
    genotype: {
        type: String,
        enum: ['AA', 'AS', 'SS', 'AC', null],
        default: null
    },
    medicalHistory: { type: [medicalHistorySchema], default: [] },
    allergies: { type: [allergySchema], default: [] },
    currentMedications: { type: [String], default: [] },

    // --- Registration State ---
    registrationStep: {
        type: String,
        enum: ['started', 'name_collected', 'dob_collected', 'gender_collected', 'complete'],
        default: 'started'
    },
    isProfileComplete: { type: Boolean, default: false },

    // --- Stats ---
    totalConsultations: { type: Number, default: 0 },
    lastConsultationAt: { type: Date, default: null },

    // --- Subscription ---
    // FIX: enum now matches the full plan keys used across the codebase
    plan: {
        type: String,
        enum: [
            'free',
            'basic_monthly',
            'basic_annual',
            'premium_monthly',
            'premium_annual'
        ],
        default: 'free'
    },
    planExpiresAt: { type: Date, default: null },

    // --- Contact (optional email for payment receipts) ---
    email: { type: String, trim: true, lowercase: true, default: null }

}, { timestamps: true });

// Virtual: age from DOB
PatientSchema.virtual('age').get(function () {
    if (!this.dateOfBirth) return null;
    const diff = Date.now() - this.dateOfBirth.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
});

// Virtual: full name
PatientSchema.virtual('fullName').get(function () {
    if (!this.firstName) return null;
    return `${this.firstName}${this.lastName ? ' ' + this.lastName : ''}`;
});

// Helper: check if patient has an active paid plan
PatientSchema.methods.hasActivePlan = function () {
    return (
        this.plan &&
        this.plan !== 'free' &&
        this.planExpiresAt &&
        new Date(this.planExpiresAt) > new Date()
    );
};

// Helper: check if patient is on a premium plan
PatientSchema.methods.isPremium = function () {
    return (
        (this.plan === 'premium_monthly' || this.plan === 'premium_annual') &&
        this.planExpiresAt &&
        new Date(this.planExpiresAt) > new Date()
    );
};

module.exports = mongoose.model('Patient', PatientSchema);