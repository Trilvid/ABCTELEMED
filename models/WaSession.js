// // models/WaSession.js
// const mongoose = require('mongoose');

// const WaSessionSchema = new mongoose.Schema({
//     phone: { type: String, required: true, unique: true },
//     step: { type: String, default: 'WELCOME' },
//     // e.g. WELCOME → SYMPTOM_COLLECT → TRIAGE → DOCTOR_MATCH → CONSULT
//     data: { type: Object, default: {} }, // symptoms, age, gender, etc.
//     consultationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Consultation' },
//     lastActive: { type: Date, default: Date.now }
// }, { timestamps: true });

// module.exports = mongoose.model('WaSession', WaSessionSchema);


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

            // Profile
            'VIEW_PROFILE',
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