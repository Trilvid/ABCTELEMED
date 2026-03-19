const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    sender: {
        type: String,
        enum: ['patient', 'doctor', 'system'],
        required: true
    },
    content: { type: String, required: true },
    sentAt: { type: Date, default: Date.now }
}, { _id: false });

const prescriptionSchema = new mongoose.Schema({
    medication: { type: String, required: true },
    dosage: { type: String, required: true },   // e.g. "500mg"
    frequency: { type: String, required: true },   // e.g. "Twice daily"
    duration: { type: String, required: true },   // e.g. "7 days"
    notes: { type: String, default: null }
}, { _id: false });

const ConsultationSchema = new mongoose.Schema({
    // --- Parties ---
    patient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Patient',
        required: true
    },
    doctor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Doctor',
        required: true
    },

    // --- Scheduling ---
    scheduledAt: { type: Date, required: true },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    duration: { type: Number, default: null },   // minutes, filled on end

    // --- Symptoms (collected from bot before booking) ---
    symptoms: { type: [String], default: [] },
    aiSummary: { type: String, default: null },   // AI triage result
    urgency: {
        type: String,
        enum: ['low', 'medium', 'high', null],
        default: null
    },

    // --- Consultation content ---
    doctorNotes: { type: String, default: null },
    diagnosis: { type: String, default: null },
    prescriptions: { type: [prescriptionSchema], default: [] },
    followUpDate: { type: Date, default: null },
    messages: { type: [messageSchema], default: [] },

    // --- Status ---
    status: {
        type: String,
        enum: ['pending', 'confirmed', 'ongoing', 'completed', 'cancelled', 'no_show'],
        default: 'pending'
    },
    cancelledBy: {
        type: String,
        enum: ['patient', 'doctor', 'system', null],
        default: null
    },
    cancellationReason: { type: String, default: null },

    // --- Payment ---
    fee: { type: Number, default: 0 },         // in Naira
    isPaid: { type: Boolean, default: false },
    paystackReference: { type: String, default: null },

    // --- Channel ---
    channel: {
        type: String,
        enum: ['whatsapp', 'web', 'mobile'],
        default: 'whatsapp'
    }

}, { timestamps: true });

module.exports = mongoose.model('Consultation', ConsultationSchema);