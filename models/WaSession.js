const mongoose = require('mongoose');

const WaSessionSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },

    // Current bot step
    step: {
        type: String,
        enum: [
            // Onboarding
            'WELCOME',
            'ASK_FIRST_NAME',
            'ASK_LAST_NAME',
            'ASK_DOB',
            'ASK_GENDER',
            'ASK_COUNTRY',
            'ASK_STATE',
            'ONBOARDING_COMPLETE',

            // Main menu
            'MAIN_MENU',

            // Symptom flow
            'SYMPTOM_COLLECT',
            'SYMPTOM_FOLLOWUP',
            'TRIAGE_RESULT',

            // Doctor flow
            'DOCTOR_LIST',
            'DOCTOR_SELECTED',
            'BOOKING_CONFIRM',
            'BOOKING_COMPLETE',

            // Subscription
            'SUBSCRIPTION_MENU',
            'PAYMENT_PENDING',
            'CONSULTATION_PAYMENT',

            // Review flow  — NEW
            'REVIEW_DOCTOR',
            'REVIEW_COMMENT',

            // History
            'VIEW_HISTORY',

            // Profile
            'VIEW_PROFILE',

            // payment method selection flow
            'PAYMENT_METHOD',
            'USSD_BANK_SELECT',
            'USSD_WAITING',
            'BANK_TRANSFER_WAITING',
        ],
        default: 'WELCOME'
    },

    // Temporary data collected mid-conversation
    data: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
        // e.g. { symptoms: [], selectedDoctorId: '', bookingDate: '' }
    },

    // Link to patient once registered
    patientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Patient',
        default: null
    },

    lastMessageAt: { type: Date, default: Date.now },

    lastActive: { type: Date, default: Date.now }

}, { timestamps: true });

module.exports = mongoose.model('WaSession', WaSessionSchema);