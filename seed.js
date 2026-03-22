require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const Doctor = require('./models/Doctor')
const Patient = require('./models/Patient');
const WaSession = require('./models/WaSession');
const Consultation = require('./models/Consultation');


const doctors = [
    {
        firstName: 'Ezinne',
        lastName: 'Obi',
        email: 'ezinne@abctelemed.com',
        phone: '2348108241437',
        password: 'Password@123',
        specialty: 'general_practice',
        licenseNumber: 'MDCN-2019-001',
        licenseExpiry: new Date('2026-12-31'),
        yearsOfExperience: 8,
        bio: 'Experienced general practitioner with a focus on preventive care and chronic disease management.',
        languages: ['English', 'Igbo'],
        consultationFee: 5000,
        status: 'verified',
        licenseVerified: true,
        verifiedAt: new Date(),
        rating: 4.7,
        totalReviews: 134,
        totalConsultations: 210,
        isAvailableNow: true,
        qualifications: [
            { degree: 'MBBS', institution: 'University of Nigeria Nsukka', year: 2014 },
            { degree: 'MPH', institution: 'University of Lagos', year: 2018 }
        ],
        availabilitySchedule: [
            { day: 'sunday', startTime: '00:00', endTime: '17:00' },
            { day: 'wednesday', startTime: '08:00', endTime: '17:00' },
            { day: 'friday', startTime: '09:00', endTime: '15:00' }
        ]
    },
    {
        firstName: 'Aisha',
        lastName: 'Bello',
        email: 'aisha.bello@abctelemed.com',
        phone: '2348108241937',
        password: 'Password@123',
        specialty: 'pediatrics',
        licenseNumber: 'MDCN-2017-002',
        licenseExpiry: new Date('2027-06-30'),
        yearsOfExperience: 10,
        bio: 'Dedicated paediatrician passionate about children\'s health from newborn to adolescence.',
        languages: ['English', 'Hausa', 'Yoruba'],
        consultationFee: 7500,
        status: 'verified',
        licenseVerified: true,
        verifiedAt: new Date(),
        rating: 4.9,
        totalReviews: 201,
        totalConsultations: 340,
        isAvailableNow: true,
        qualifications: [
            { degree: 'MBBS', institution: 'Ahmadu Bello University', year: 2012 },
            { degree: 'FWACP', institution: 'West African College of Physicians', year: 2017 }
        ],
        availabilitySchedule: [
            { day: 'tuesday', startTime: '09:00', endTime: '18:00' },
            { day: 'thursday', startTime: '09:00', endTime: '18:00' },
            { day: 'saturday', startTime: '10:00', endTime: '14:00' }
        ]
    },
    {
        firstName: 'Tunde',
        lastName: 'Adeyemi',
        email: 'tunde.adeyemi@abctelemed.com',
        phone: '2348108241417',
        password: 'Password@123',
        specialty: 'cardiology',
        licenseNumber: 'MDCN-2015-003',
        licenseExpiry: new Date('2025-11-30'),
        yearsOfExperience: 14,
        bio: 'Consultant cardiologist specialising in heart failure, hypertension, and interventional cardiology.',
        languages: ['English', 'Yoruba'],
        consultationFee: 15000,
        status: 'verified',
        licenseVerified: true,
        verifiedAt: new Date(),
        rating: 4.8,
        totalReviews: 89,
        totalConsultations: 156,
        isAvailableNow: false,
        qualifications: [
            { degree: 'MBBS', institution: 'University of Ibadan', year: 2009 },
            { degree: 'FMCP', institution: 'National Postgraduate Medical College of Nigeria', year: 2015 }
        ],
        availabilitySchedule: [
            { day: 'monday', startTime: '10:00', endTime: '16:00' },
            { day: 'thursday', startTime: '10:00', endTime: '16:00' }
        ]
    },
    {
        firstName: 'Ngozi',
        lastName: 'Eze',
        email: 'ngozi.eze@abctelemed.com',
        phone: '2348108241497',
        password: 'Password@123',
        specialty: 'gynecology',
        licenseNumber: 'MDCN-2016-004',
        licenseExpiry: new Date('2026-08-31'),
        yearsOfExperience: 12,
        bio: 'Gynaecologist and obstetrician with special interest in maternal health and fertility.',
        languages: ['English', 'Igbo'],
        consultationFee: 10000,
        status: 'verified',
        licenseVerified: true,
        verifiedAt: new Date(),
        rating: 4.6,
        totalReviews: 112,
        totalConsultations: 198,
        isAvailableNow: true,
        qualifications: [
            { degree: 'MBBS', institution: 'University of Benin', year: 2010 },
            { degree: 'FWACS', institution: 'West African College of Surgeons', year: 2016 }
        ],
        availabilitySchedule: [
            { day: 'tuesday', startTime: '08:00', endTime: '16:00' },
            { day: 'friday', startTime: '08:00', endTime: '14:00' }
        ]
    },
    {
        firstName: 'Ibrahim',
        lastName: 'Musa',
        email: 'ibrahim.musa@abctelemed.com',
        phone: '2348108241407',
        password: 'Password@123',
        specialty: 'dermatology',
        licenseNumber: 'MDCN-2018-005',
        licenseExpiry: new Date('2027-03-31'),
        yearsOfExperience: 7,
        bio: 'Dermatologist focused on skin conditions common in tropical climates including eczema, psoriasis, and infections.',
        languages: ['English', 'Hausa'],
        consultationFee: 8000,
        status: 'pending',   // Not yet verified — to test that flow
        licenseVerified: false,
        rating: 0,
        totalReviews: 0,
        totalConsultations: 0,
        isAvailableNow: false,
        qualifications: [
            { degree: 'MBBS', institution: 'Bayero University Kano', year: 2015 }
        ],
        availabilitySchedule: []
    }
];


const patients = [
    {
        whatsappNumber: '234903418738834',   // ← change this to your test number
        firstName: 'Emeka',
        lastName: 'Nwosu',
        dateOfBirth: new Date('1990-05-15'),
        gender: 'male',
        'location.state': 'Rivers',
        bloodGroup: 'O+',
        genotype: 'AA',
        isProfileComplete: true,
        plan: 'free',
        totalConsultations: 2,
        medicalHistory: [
            { condition: 'Hypertension', diagnosedYear: 2020, onMedication: true, notes: 'On Amlodipine 5mg' }
        ],
        allergies: [
            { allergen: 'Penicillin', reaction: 'Rash and swelling' }
        ]
    },
    {
        whatsappNumber: '2349034187328',   // ← change this to another test number
        firstName: 'Fatima',
        lastName: 'Abdullahi',
        dateOfBirth: new Date('1995-11-22'),
        gender: 'female',
        'location.state': 'Abuja',
        bloodGroup: 'A+',
        genotype: 'AS',
        isProfileComplete: true,
        plan: 'basic',
        totalConsultations: 5,
        medicalHistory: [],
        allergies: []
    },
    {
        whatsappNumber: '2349034187318',   // ← change this to another test number
        firstName: 'Chidi',
        lastName: 'Okeke',
        dateOfBirth: new Date('1988-03-08'),
        gender: 'male',
        'location.state': 'Lagos',
        bloodGroup: 'B+',
        genotype: 'AA',
        isProfileComplete: true,
        plan: 'premium',
        totalConsultations: 12,
        medicalHistory: [
            { condition: 'Type 2 Diabetes', diagnosedYear: 2019, onMedication: true, notes: 'On Metformin 500mg twice daily' },
            { condition: 'High Cholesterol', diagnosedYear: 2021, onMedication: true }
        ],
        allergies: []
    }
];

async function seedDB() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB');

        await Promise.all([
            Doctor.deleteMany({}),
            Patient.deleteMany({}),
            WaSession.deleteMany({}),
            Consultation.deleteMany({})
        ]);
        console.log('🗑️  Cleared existing data');

        // ── Seed Doctors      
        const hashedPassword = await bcrypt.hash('Password@123', 12);
        const createdDoctors = await Doctor.insertMany(
            doctors.map(d => ({ ...d, password: hashedPassword }))
        );
        console.log(`👨‍⚕️  Seeded ${createdDoctors.length} doctors`);

        // ── Seed Patients      
        const createdPatients = await Patient.insertMany(patients);
        console.log(`🧑‍🤝‍🧑 Seeded ${createdPatients.length} patients`);

        // ── Seed WaSessions (one per patient — all at MAIN_MENU) ────
        const sessions = createdPatients.map(p => ({
            phone: p.whatsappNumber,
            step: 'MAIN_MENU',
            patientId: p._id,
            data: {}
        }));
        await WaSession.insertMany(sessions);
        console.log(`💬 Seeded ${sessions.length} WhatsApp sessions`);

        // ── Seed Consultations ---
        const verifiedDoctors = createdDoctors.filter(d => d.status === 'verified');

        const consultations = [
            {
                patient: createdPatients[0]._id,
                doctor: verifiedDoctors[0]._id,   // Dr. Emeka Obi (GP)
                scheduledAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),  // 2 days ago
                startedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
                endedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 + 20 * 60 * 1000),
                duration: 20,
                symptoms: ['headache', 'fever', 'body aches'],
                aiSummary: 'Symptoms consistent with viral fever. Moderate urgency.',
                urgency: 'medium',
                doctorNotes: 'Patient presented with 2-day history of fever and generalised body aches. No signs of malaria.',
                diagnosis: 'Viral Upper Respiratory Tract Infection',
                prescriptions: [
                    { medication: 'Paracetamol', dosage: '1000mg', frequency: 'Every 6 hours', duration: '5 days', notes: 'Take after food' },
                    { medication: 'Vitamin C', dosage: '500mg', frequency: 'Once daily', duration: '7 days' }
                ],
                status: 'completed',
                isPaid: true,
                fee: 5000,
                channel: 'whatsapp'
            },
            {
                patient: createdPatients[1]._id,
                doctor: verifiedDoctors[1]._id,   // Dr. Aisha Bello (Paediatrics)
                scheduledAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),  // tomorrow
                symptoms: ['child has rash', 'mild fever', 'loss of appetite'],
                aiSummary: 'Child symptoms may indicate viral exanthem. Recommend paediatric review.',
                urgency: 'medium',
                status: 'confirmed',
                isPaid: true,
                fee: 7500,
                channel: 'whatsapp'
            },
            {
                patient: createdPatients[2]._id,
                doctor: verifiedDoctors[2]._id,   // Dr. Tunde Adeyemi (Cardiology)
                scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),  // 3 days from now
                symptoms: ['chest tightness', 'shortness of breath on exertion', 'occasional palpitations'],
                aiSummary: 'Cardiac symptoms in a diabetic patient. High urgency — cardiologist review recommended.',
                urgency: 'high',
                status: 'pending',
                isPaid: false,
                fee: 15000,
                channel: 'whatsapp'
            },
            {
                patient: createdPatients[0]._id,
                doctor: verifiedDoctors[3]._id,   // Dr. Ngozi Eze (Gynecology)
                scheduledAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
                startedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
                endedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
                duration: 30,
                symptoms: ['irregular periods', 'lower abdominal pain'],
                diagnosis: 'Dysmenorrhoea — primary',
                prescriptions: [
                    { medication: 'Ibuprofen', dosage: '400mg', frequency: 'Three times daily', duration: '5 days', notes: 'Take with food' }
                ],
                status: 'completed',
                isPaid: true,
                fee: 10000,
                channel: 'whatsapp'
            }
        ];

        const createdConsultations = await Consultation.insertMany(consultations);
        console.log(`📋 Seeded ${createdConsultations.length} consultations`);

        // ── Summary ──
        console.log('\n──────────────────────────────────────────');
        console.log('🌱 Seed complete! Here\'s a quick reference:');
        console.log('──────────────────────────────────────────');
        console.log('\n👨‍⚕️  DOCTORS');
        createdDoctors.forEach(d => {
            console.log(`  Dr. ${d.firstName} ${d.lastName} | ${d.specialty} | status: ${d.status} | ID: ${d._id}`);
        });
        console.log('\n🧑  PATIENTS');
        createdPatients.forEach(p => {
            console.log(`  ${p.firstName} ${p.lastName} | WhatsApp: ${p.whatsappNumber} | ID: ${p._id}`);
        });
        console.log('\n📋 CONSULTATIONS');
        createdConsultations.forEach(c => {
            console.log(`  ID: ${c._id} | status: ${c.status} | urgency: ${c.urgency || 'N/A'}`);
        });
        console.log('\n──────────────────────────────────────────\n');

        process.exit(0);
    } catch (err) {
        console.error('❌ Seed failed:', err);
        process.exit(1);
    }
}

seedDB();