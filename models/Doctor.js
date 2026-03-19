const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const qualificationSchema = new mongoose.Schema({
    degree: { type: String, required: true },       // e.g. MBBS, MD
    institution: { type: String, required: true },
    year: { type: Number, required: true }
}, { _id: false });

const availabilitySlotSchema = new mongoose.Schema({
    day: {
        type: String,
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
        required: true
    },
    startTime: { type: String, required: true },   // "08:00"
    endTime: { type: String, required: true }       // "17:00"
}, { _id: false });

const DoctorSchema = new mongoose.Schema({
    // --- Personal Info ---
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, required: true, unique: true, trim: true },
    whatsappNumber: { type: String, trim: true }, // if different from phone
    password: { type: String, required: true, select: false },
    photo: { type: String, default: null },    // URL to profile image

    // --- Professional Info ---
    specialty: {
        type: String,
        required: true,
        enum: [
            'general_practice', 'cardiology', 'dermatology', 'pediatrics',
            'gynecology', 'orthopedics', 'neurology', 'psychiatry',
            'ophthalmology', 'ent', 'urology', 'oncology', 'endocrinology',
            'gastroenterology', 'pulmonology', 'nephrology', 'other'
        ]
    },
    qualifications: { type: [qualificationSchema], default: [] },
    licenseNumber: { type: String, required: true, unique: true, trim: true },
    licenseExpiry: { type: Date, required: true },
    yearsOfExperience: { type: Number, required: true, min: 0 },
    bio: { type: String, maxlength: 1000 },
    languages: { type: [String], default: ['English'] },

    // --- Availability ---
    availabilitySchedule: { type: [availabilitySlotSchema], default: [] },
    consultationDuration: { type: Number, default: 15 }, // minutes per slot
    isAvailableNow: { type: Boolean, default: false }, // manual online toggle

    // --- Pricing ---
    consultationFee: { type: Number, default: 0 }, // in Naira (kobo for Paystack: multiply x100)
    currency: { type: String, default: 'NGN' },

    // --- Status & Verification ---
    status: {
        type: String,
        enum: ['pending', 'verified', 'suspended', 'rejected'],
        default: 'pending'
    },
    licenseVerified: { type: Boolean, default: false },
    verifiedAt: { type: Date, default: null },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    rejectionReason: { type: String, default: null },

    // --- Stats ---
    rating: { type: Number, default: 0, min: 0, max: 5 },
    totalReviews: { type: Number, default: 0 },
    totalConsultations: { type: Number, default: 0 },

    // --- Auth ---
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    lastLogin: { type: Date, default: null },

}, { timestamps: true });

// --- Virtual: full name ---
DoctorSchema.virtual('fullName').get(function () {
    return `Dr. ${this.firstName} ${this.lastName}`;
});

// --- Pre-save: hash password ---
DoctorSchema.pre('save', async function (req, res, next) {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 12);
});

// --- Method: compare password ---
DoctorSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

// --- Method: safe public profile (no sensitive fields) ---
DoctorSchema.methods.toPublicProfile = function () {
    return {
        id: this._id,
        fullName: this.fullName,
        specialty: this.specialty,
        qualifications: this.qualifications,
        yearsOfExperience: this.yearsOfExperience,
        bio: this.bio,
        languages: this.languages,
        rating: this.rating,
        totalReviews: this.totalReviews,
        consultationFee: this.consultationFee,
        currency: this.currency,
        isAvailableNow: this.isAvailableNow,
        availabilitySchedule: this.availabilitySchedule,
        photo: this.photo,
    };
};

module.exports = mongoose.model('Doctor', DoctorSchema);