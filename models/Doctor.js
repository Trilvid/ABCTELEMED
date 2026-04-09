const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const qualificationSchema = new mongoose.Schema({
    degree: { type: String, required: true },
    institution: { type: String, required: true },
    year: { type: Number, required: true }
}, { _id: false });

const availabilitySlotSchema = new mongoose.Schema({
    day: {
        type: String,
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
        required: true
    },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true }
}, { _id: false });

const DoctorSchema = new mongoose.Schema({
    // --- Personal Info ---
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, required: true, unique: true, trim: true },
    whatsappNumber: { type: String, trim: true },
    password: { type: String, required: true, select: false },
    photo: { type: String, default: null },   // Cloudinary URL

    // --- Documents (Cloudinary URLs) ---
    certificateUrl: { type: String, default: null },   // medical certificate
    licenseDocUrl: { type: String, default: null },   // MDCN license scan

    // --- Professional Info ---
    specialty: {
        type: String, required: true,
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
    consultationDuration: { type: Number, default: 15 },
    isAvailableNow: { type: Boolean, default: false },
    isOnCall: { type: Boolean, default: false },
    activeConsultationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Consultation', default: null },

    // --- Pricing ---
    consultationFee: { type: Number, default: 0 },
    currency: { type: String, default: 'NGN' },

    // --- Bank details (for payouts) ---
    bankDetails: {
        bankName: { type: String, default: null },
        accountNumber: { type: String, default: null },
        accountName: { type: String, default: null },
    },

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
DoctorSchema.pre('save', async function () {
    if (!this.isModified('password')) return;
    this.password = await bcrypt.hash(this.password, 12);
});

// --- Method: compare password ---
DoctorSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

// --- Method: safe public profile ---
DoctorSchema.methods.toPublicProfile = function ({ includeSensitive = false } = {}) {
    const profile = {
        id: this._id,
        fullName: this.fullName,
        firstName: this.firstName,
        lastName: this.lastName,
        photo: this.photo,
        specialty: this.specialty,
        yearsOfExperience: this.yearsOfExperience,
        bio: this.bio,
        languages: this.languages,
        rating: this.rating,
        totalReviews: this.totalReviews,
        totalConsultations: this.totalConsultations,
        consultationFee: this.consultationFee,
        currency: this.currency,
        isAvailableNow: this.isAvailableNow,
        isOnCall: this.isOnCall,
        availabilitySchedule: this.availabilitySchedule,
        consultationDuration: this.consultationDuration,
        status: this.status,
        createdAt: this.createdAt,
    };

    if (includeSensitive) {
        profile.email = this.email;
        profile.phone = this.phone;
        profile.whatsappNumber = this.whatsappNumber;
        profile.certificateUrl = this.certificateUrl;
        profile.qualifications = this.qualifications;
        profile.licenseNumber = this.licenseNumber;
        profile.licenseExpiry = this.licenseExpiry;
        profile.activeConsultationId = this.activeConsultationId;
        profile.licenseVerified = this.licenseVerified;
        profile.bankDetails = this.bankDetails;
    }

    return profile;
};

module.exports = mongoose.model('Doctor', DoctorSchema);
