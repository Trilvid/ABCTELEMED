const mongoose = require('mongoose');

const medicalHistorySchema = new mongoose.Schema({
    condition: { type: String, required: true },  // e.g. "Hypertension"
    diagnosedYear: { type: Number },
    onMedication: { type: Boolean, default: false },
    notes: { type: String }
}, { _id: false });

const allergySchema = new mongoose.Schema({
    allergen: { type: String, required: true },   // e.g. "Penicillin"
    reaction: { type: String }                   // e.g. "Rash, swelling"
}, { _id: false });

const PatientSchema = new mongoose.Schema({
    // --- Identity ---
    whatsappNumber: { type: String, required: true, unique: true, trim: true },
    // e.g. "2348012345678" — always stored in international format without +
    firstName: { type: String, trim: true, default: null },
    lastName: { type: String, trim: true, default: null },
    dateOfBirth: { type: Date, default: null },
    gender: {
        type: String,
        enum: ['male', 'female', 'prefer_not_to_say', null],
        default: null
    },
    location: {
        state: { type: String, default: null },   // e.g. "Lagos"
        country: { type: String, default: 'Nigeria' }
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

    // --- Subscription (for gating paid features) ---
    plan: {
        type: String,
        enum: ['free', 'basic', 'premium'],
        default: 'free'
    },
    planExpiresAt: { type: Date, default: null },

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

module.exports = mongoose.model('Patient', PatientSchema);