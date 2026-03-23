// services/botFlowService.js
const WaSession = require('../models/WaSession');
const whatsappService = require('./whatsappService');
const aiService = require('./aiService');
const Patient = require('../models/Patient');
const Doctor = require('../models/Doctor');
const Consultation = require('../models/Consultation');
const paystackService = require('./paystackService');

const onboarding = require('./onboardingService');
const { collectFirstName, collectLastName, collectDob, collectGender, collectState } = require('./onboardingService');
const mainMenu = require('./mainMenuService');



const STEPS = {
    WELCOME: handleWelcome,
    SYMPTOM_COLLECT: handleSymptoms,
    TRIAGE: handleTriage,
    DOCTOR_MATCH: handleDoctorMatch,

    // Onboarding steps (extend)
    ASK_FIRST_NAME: handleAskFirstName,
    ASK_LAST_NAME: handleAskLastName,
    ASK_DOB: handleAskDob,
    ASK_GENDER: handleAskGender,
    ASK_STATE: handleAskState,
    MAIN_MENU: handleMainMenu,

    // Booking steps (extend)
    SUBSCRIPTION_MENU: handleSubscriptionMenu,
    PAYMENT_PENDING: handlePaymentPending,

    DOCTOR_SELECTED: handleDoctorSelected,
    BOOKING_CONFIRM: handleBookingConfirm,
    BOOKING_COMPLETE: handleBookingComplete,
    VIEW_HISTORY: handleViewHistory,
};


exports.processMessage = async ({ from, type, text, message }) => {

    if (type === 'interactive') {
        const interactive = message.interactive;
        text =
            interactive?.button_reply?.id ||
            interactive?.list_reply?.id ||
            text;
    }

    let session = await WaSession.findOneAndUpdate(
        { phone: from },
        { lastMessageAt: new Date() },
        { upsert: true, new: true }
    );

    const handler = STEPS[session.step] || handleWelcome;
    await handler(from, text, session, message);
};


// HandleWelcome function — checks if patient exists and routes to onboarding or main menu accordingly
async function handleWelcome(from, text, session) {

    const existing = await Patient.findOne({ whatsappNumber: from });

    if (existing && existing.isProfileComplete) {
        // Returning user — update session link and go to main menu
        await WaSession.updateOne(
            { phone: from },
            { step: 'MAIN_MENU', patientId: existing._id }
        );
        const planBadge = existing.plan === 'premium'
            ? '⚡ Premium'
            : existing.plan === 'basic'
                ? '✅ Basic'
                : '🆓 Free';

        return whatsappService.sendButtons(from,
            `Welcome back, *${existing.firstName}*! 👋\n\nPlan: *${planBadge}*\n\nHow can I help you today?`,
            [
                { id: 'consult', title: '🩺 See a doctor' },
                { id: 'subscribe', title: '💳 Upgrade plan' },
                { id: 'history', title: '📋 My history' }
            ]
        );
    }

    // ── New user — start onboarding ───────────────────────────────────────────
    await WaSession.updateOne({ phone: from }, { step: 'ASK_FIRST_NAME' });
    return whatsappService.sendText(from,
        `👋 Welcome to *AbcTeleMed*!\n\nGet quality healthcare advice and connect with verified doctors — right here on WhatsApp.\n\nLet's set up your profile quickly.\n\n*What is your first name?*`
    );
}

async function handleSymptoms(from, text, session) {
    const symptoms = [...(session.data.symptoms || []), text];
    await WaSession.updateOne({ phone: from }, { 'data.symptoms': symptoms });

    // Ask follow-up or move to AI triage
    await whatsappService.sendButtons(from,
        `Got it. Would you like to add more symptoms or proceed to analysis?`,
        [
            { id: 'add_more', title: 'Add more' },
            { id: 'proceed', title: 'Analyse now' }
        ]
    );
    await WaSession.updateOne({ phone: from }, { step: 'TRIAGE' });
}

async function handleTriage(from, text, session) {
    const symptoms = session.data.symptoms;
    const analysis = await aiService.analyseSymptoms(symptoms);

    // Save AI result to session for use in booking
    await WaSession.updateOne({ phone: from }, {
        'data.aiSummary': analysis.summary,
        'data.specialty': analysis.specialty,
        'data.urgency': analysis.urgency
    });


    await whatsappService.sendText(from,
        `🔍 *Based on your symptoms:*\n\n${analysis.summary}\n\n_Recommended next step: ${analysis.recommendation}_`
    );

    // If doctor referral needed, pull from your existing doctor API
    if (analysis.needsDoctor) {
        await WaSession.updateOne({ phone: from }, { step: 'DOCTOR_MATCH' });
        await handleDoctorMatch(from, text, session);
    } else {
        // Self-care — no doctor needed, return to main menu
        await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU' });
        await whatsappService.sendButtons(from,
            `✅ Based on your symptoms, you should be fine managing this at home.\n\nIf symptoms worsen, please start a new consultation.`,
            [
                { id: 'consult', title: '🩺 See a doctor anyway' },
                { id: 'history', title: '📋 My history' }
            ]
        );
    }
}

// ──Handles Doctor Match — splits behaviour by plan ───
async function handleDoctorMatch(from, text, session) {
    const patient = await Patient.findOne({ whatsappNumber: from });
    const specialty = session.data?.specialty || 'general_practice';

    // ── PREMIUM: auto-assign the first available/on-call doctor ───
    if (patient?.plan === 'premium') {
        const doctor = await Doctor.findOne({
            specialty,
            status: 'verified',
            $or: [{ isOnCall: true }, { isAvailableNow: true }],
            activeConsultationId: null   // not busy with another patient
        }).sort({ rating: -1 });

        if (doctor) {
            // Auto-book immediately
            const consultation = await Consultation.create({
                patient: patient._id,
                doctor: doctor._id,
                scheduledAt: new Date(),
                symptoms: session.data.symptoms || [],
                aiSummary: session.data.aiSummary || null,
                urgency: session.data.urgency || null,
                status: 'confirmed',
                channel: 'whatsapp',
                fee: doctor.consultationFee
            });

            // Mark doctor as busy
            await Doctor.findByIdAndUpdate(doctor._id, {
                activeConsultationId: consultation._id,
                isAvailableNow: false
            });

            await WaSession.updateOne({ phone: from }, {
                step: 'MAIN_MENU',
                data: {}
            });

            return whatsappService.sendText(from,
                `⚡ *Doctor Assigned Instantly!*\n\n👨‍⚕️ *Dr. ${doctor.firstName} ${doctor.lastName}*\n🏥 ${doctor.specialty}\n⭐ ${doctor.rating} rating\n\n📋 Consultation ID: *${consultation._id}*\n\nThe doctor will contact you on WhatsApp shortly.\n\n_Type anything to return to the main menu._`
            );
        }

        // Premium but no doctor available right now — fall through to list
        await whatsappService.sendText(from,
            `⚡ No doctors are available for instant assignment right now.\n\nShowing you available doctors to choose from instead:`
        );
    }

    // ── FREE / BASIC: show doctor list to choose from ─────

    const doctors = await Doctor.find({
        specialty,
        status: 'verified',
        isAvailableNow: true,
        activeConsultationId: null
    })
        .sort({ rating: -1 })
        .limit(3);

    if (!doctors.length) {
        await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });
        return whatsappService.sendButtons(from,
            `😔 No doctors are currently available for *${specialty.replace('_', ' ')}*.\n\nPlease try again in a little while.`,
            [
                { id: 'consult', title: '🩺 Try again' },
                { id: 'history', title: '📋 My history' }
            ]
        );
    }

    const rows = doctors.map(d => ({
        id: d._id.toString(),
        title: `Dr. ${d.firstName} ${d.lastName}`,
        description: `${d.specialty.replace('_', ' ')} • ⭐ ${d.rating} • ₦${d.consultationFee.toLocaleString()}`
    }));

    await WaSession.updateOne({ phone: from }, { step: 'DOCTOR_SELECTED' });
    return whatsappService.sendList(from, 'Choose a doctor to consult:', 'View Doctors', rows);
}


// Onboarding extensions
async function handleAskFirstName(from, text, session) {
    const firstName = text?.trim();
    if (!firstName || firstName.length < 2)
        return whatsappService.sendText(from, `Please enter a valid first name.`);

    await WaSession.updateOne({ phone: from }, { step: 'ASK_LAST_NAME', 'data.firstName': firstName });
    return whatsappService.sendText(from, `Nice to meet you, *${firstName}*! 😊\n\nWhat is your last name?`);
}

async function handleAskLastName(from, text, session) {
    const lastName = text?.trim();
    if (!lastName || lastName.length < 2)
        return whatsappService.sendText(from, `Please enter a valid last name.`);

    await WaSession.updateOne({ phone: from }, { step: 'ASK_DOB', 'data.lastName': lastName });
    return whatsappService.sendText(from,
        `Got it! Now, what is your *date of birth*?\n\nPlease reply in this format: *DD/MM/YYYY*\n_Example: 15/03/1990_`
    );
}

async function handleAskDob(from, text, session) {
    const parts = text?.trim().split('/');
    if (parts?.length !== 3)
        return whatsappService.sendText(from, `❌ Invalid format. Please use *DD/MM/YYYY*\n_Example: 15/03/1990_`);

    const [day, month, year] = parts.map(Number);
    const dob = new Date(year, month - 1, day);
    const age = Math.floor((Date.now() - dob) / (1000 * 60 * 60 * 24 * 365.25));
    if (isNaN(dob.getTime()) || age < 1 || age > 120)
        return whatsappService.sendText(from, `❌ That doesn't look like a valid date. Please try again using *DD/MM/YYYY*.`);

    await WaSession.updateOne({ phone: from }, { step: 'ASK_GENDER', 'data.dob': dob });
    return whatsappService.sendButtons(from, `Thanks! What is your *gender*?`, [
        { id: 'male', title: 'Male' },
        { id: 'female', title: 'Female' },
        // { id: 'prefer_not_to_say', title: 'Prefer not to say' }
    ]);
}

async function handleAskGender(from, text, session) {
    const valid = ['male', 'female', 'prefer_not_to_say'];
    const gender = text?.toLowerCase().trim();
    if (!valid.includes(gender))
        return whatsappService.sendButtons(from, `Please select one of the options:`, [
            { id: 'male', title: 'Male' },
            { id: 'female', title: 'Female' },
            { id: 'prefer_not_to_say', title: 'Prefer not to say' }
        ]);

    await WaSession.updateOne({ phone: from }, { step: 'ASK_STATE', 'data.gender': gender });
    return whatsappService.sendText(from,
        `Almost done! 🎉\n\nWhich *state* are you based in?\n_Example: Lagos, Abuja, Rivers, Enugu_`
    );
}

async function handleAskState(from, text, session) {
    const state = text?.trim();
    if (!state || state.length < 2)
        return whatsappService.sendText(from, `Please enter your state. _Example: Lagos_`);

    const d = session.data;
    const patient = await require('../models/Patient').findOneAndUpdate(
        { whatsappNumber: from },
        {
            whatsappNumber: from,
            firstName: d.firstName,
            lastName: d.lastName,
            dateOfBirth: d.dob,
            gender: d.gender,
            'location.state': state,
            isProfileComplete: true
        },
        { upsert: true, new: true }
    );

    await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', patientId: patient._id, data: {} });
    return whatsappService.sendButtons(from,
        `✅ *Profile complete, ${patient.firstName}!*\n\nHere's what you can do:`,
        [
            { id: 'consult', title: '🩺 See a doctor' },
            { id: 'history', title: '📋 My history' },
            { id: 'profile', title: '👤 My profile' }
        ]
    );
}

// ──  handleMainMenu — adds subscription option to the menu ───
async function handleMainMenu(from, text, session) {
    const choice = text?.toLowerCase().trim();

    if (choice === 'consult') {
        const patient = await Patient.findOne({ whatsappNumber: from });
        const now = new Date();
        const hasActivePlan =
            patient?.plan &&
            patient.plan !== 'free' &&
            patient.planExpiresAt &&
            new Date(patient.planExpiresAt) > now;

        if (!hasActivePlan) {
            await WaSession.updateOne({ phone: from }, { step: 'SUBSCRIPTION_MENU' });
            return whatsappService.sendButtons(from,
                `🔒 *Subscription Required*\n\nYou need an active plan to consult a doctor.\n\nChoose a plan to get started:`,
                [
                    { id: 'plan_basic', title: '✅ Basic — ₦950/mo' },
                    { id: 'plan_premium', title: '⚡ Premium — ₦2,500/mo' },
                    { id: 'plan_cancel', title: '🔙 Back' }
                ]
            );
        }

        // ── Has active plan — proceed to symptom collection ──
        await WaSession.updateOne({ phone: from }, { step: 'SYMPTOM_COLLECT', data: {} });
        return whatsappService.sendText(from,
            `*Start a Consultation*\n\nDescribe your symptoms in as much detail as you can.\n\n Example: I have a headache, slight fever and body aches since yesterday.`
        );
    }

    if (choice === 'subscribe') {
        await WaSession.updateOne({ phone: from }, { step: 'SUBSCRIPTION_MENU' });
        return handleSubscriptionMenu(from, text, session);
    }

    if (choice === 'history') {
        await WaSession.updateOne({ phone: from }, { step: 'VIEW_HISTORY' });
        return handleViewHistory(from, text, session);
    }

    // Default — show full main menu
    const patient = await Patient.findOne({ whatsappNumber: from });
    const planBadge = patient?.plan === 'premium'
        ? '⚡ Premium'
        : patient?.plan === 'basic'
            ? '✅ Basic'
            : '🆓 Free';

    return whatsappService.sendButtons(from,
        `🏥 *AbcTeleMed Main Menu*\n\nPlan: *${planBadge}*\n\nHow can we help you today?`,
        [
            { id: 'consult', title: '🩺 See a doctor' },
            { id: 'subscribe', title: '💳 Upgrade plan' },
            { id: 'history', title: '📋 My history' }
        ]
    );
}

// Booking flow extensions
async function handleDoctorSelected(from, text, session) {
    try {
        const mongoose = require('mongoose');
        const input = text?.trim();

        // ── Guard: if input is not a valid ObjectId, re-show the doctor list ──────
        if (!input || !mongoose.Types.ObjectId.isValid(input)) {
            // Re-run doctor match to show the list again
            const specialty = session.data?.specialty || 'general_practice';
            const doctors = await Doctor.find({
                specialty,
                status: 'verified',
                isAvailableNow: true,
                activeConsultationId: null
            })
                .sort({ rating: -1 })
                .limit(3);

            if (!doctors.length) {
                await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });
                return whatsappService.sendButtons(from,
                    `😔 No doctors are currently available.\n\nPlease try again shortly.`,
                    [
                        { id: 'consult', title: '🩺 Try again' },
                        { id: 'history', title: '📋 My history' }
                    ]
                );
            }

            const rows = doctors.map(d => ({
                id: d._id.toString(),
                title: `Dr. ${d.firstName} ${d.lastName}`,
                description: `${d.specialty.replace('_', ' ')} • ⭐ ${d.rating} • ₦${d.consultationFee.toLocaleString()}`
            }));

            return whatsappService.sendList(
                from,
                'Please select a doctor from the list below:',
                'View Doctors',
                rows
            );
        }

        // ── Valid ObjectId — find the doctor ──────────────────────────────────────
        const doctor = await Doctor.findById(input);

        if (!doctor || doctor.status !== 'verified') {
            return whatsappService.sendText(from,
                `❌ That doctor is no longer available. Please select another.`
            );
        }

        await WaSession.updateOne({ phone: from }, {
            step: 'BOOKING_CONFIRM',
            'data.selectedDoctorId': input
        });

        return whatsappService.sendButtons(from,
            `👨‍⚕️ *Dr. ${doctor.firstName} ${doctor.lastName}*\n🏥 ${doctor.specialty.replace('_', ' ')}\n⭐ ${doctor.rating} rating\n💰 ₦${doctor.consultationFee.toLocaleString()}\n\nConfirm your booking?`,
            [
                { id: 'confirm_booking', title: '✅ Confirm' },
                { id: 'cancel_booking', title: '❌ Cancel' }
            ]
        );
    } catch (err) {
        console.error('❌ handleDoctorSelected error:', err.message);
        await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });
        return whatsappService.sendButtons(from,
            `❌ Something went wrong selecting that doctor. Please try again.`,
            [
                { id: 'consult', title: '🩺 Try again' },
                { id: 'history', title: '📋 My history' }
            ]
        );
    }
}


// async function handleBookingConfirm(from, text, session) {
//     if (text === 'cancel_booking') {
//         await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });
//         return whatsappService.sendButtons(from,
//             `Booking cancelled. What would you like to do?`,
//             [
//                 { id: 'consult', title: '🩺 See a doctor' },
//                 { id: 'history', title: '📋 My history' },
//                 { id: 'subscribe', title: '💳 Upgrade plan' }
//             ]
//         );
//     }

//     if (text !== 'confirm_booking') {
//         return whatsappService.sendButtons(from,
//             `Please confirm or cancel your booking:`,
//             [
//                 { id: 'confirm_booking', title: '✅ Confirm' },
//                 { id: 'cancel_booking', title: '❌ Cancel' }
//             ]
//         );
//     }

//     // ── Create the consultation record ───
//     const consultation = await Consultation.create({
//         patient: session.patientId,
//         doctor: session.data.selectedDoctorId,
//         scheduledAt: new Date(Date.now() + 30 * 60 * 1000),
//         symptoms: session.data.symptoms || [],
//         aiSummary: session.data.aiSummary || null,
//         urgency: session.data.urgency || null,
//         channel: 'whatsapp',
//         status: 'confirmed'
//     });

//     // ── Mark doctor as busy ─── 
//     await Doctor.findByIdAndUpdate(session.data.selectedDoctorId, {
//         isAvailableNow: false,
//         activeConsultationId: consultation._id
//     });

//     // ── Fetch patient + doctor details for notifications ────
//     const [patient, doctor] = await Promise.all([
//         Patient.findById(session.patientId).select('firstName lastName whatsappNumber'),
//         Doctor.findById(session.data.selectedDoctorId).select('firstName lastName whatsappNumber phone specialty')
//     ]);

//     // ── Notify the DOCTOR on WhatsApp ───
//     const doctorWhatsapp = doctor.whatsappNumber || doctor.phone;
//     if (doctorWhatsapp) {
//         await whatsappService.sendText(doctorWhatsapp,
//             `🔔 *New Consultation Booked*\n\n` +
//             `👤 *Patient:* ${patient.firstName} ${patient.lastName}\n` +
//             `📱 *WhatsApp:* +${patient.whatsappNumber}\n` +
//             `🏥 *Specialty:* ${doctor.specialty.replace('_', ' ')}\n` +
//             `🤒 *Symptoms:* ${(session.data.symptoms || []).join(', ')}\n` +
//             `⚠️ *Urgency:* ${session.data.urgency || 'N/A'}\n` +
//             `📋 *Consultation ID:* ${consultation._id}\n\n` +
//             `_Please reach out to the patient on WhatsApp to begin the consultation._`
//         );
//     }

//     // ── Advance patient session ─── 
//     await WaSession.updateOne({ phone: from }, {
//         step: 'BOOKING_COMPLETE',
//         'data.consultationId': consultation._id
//     });

//     // ── Confirm to PATIENT ────
//     return whatsappService.sendText(from,
//         `✅ *Booking Confirmed!*\n\n` +
//         `👨‍⚕️ *Doctor:* Dr. ${doctor.firstName} ${doctor.lastName}\n` +
//         `🏥 *Specialty:* ${doctor.specialty.replace('_', ' ')}\n` +
//         `📋 *Ref:* ${consultation._id}\n\n` +
//         `The doctor has been notified and will contact you on WhatsApp shortly.\n\n` +
//         `Type anything to return to the main menu.`
//     );
// }

async function handleBookingConfirm(from, text, session) {
    if (text === 'cancel_booking') {
        await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });
        return whatsappService.sendButtons(from,
            `Booking cancelled. What would you like to do?`,
            [
                { id: 'consult', title: '🩺 See a doctor' },
                { id: 'history', title: '📋 My history' },
                { id: 'subscribe', title: '💳 Upgrade plan' }
            ]
        );
    }

    if (text !== 'confirm_booking') {
        return whatsappService.sendButtons(from,
            `Please confirm or cancel your booking:`,
            [
                { id: 'confirm_booking', title: '✅ Confirm' },
                { id: 'cancel_booking', title: '❌ Cancel' }
            ]
        );
    }

    // ── Resolve patientId — from session or fallback to DB lookup ─────────────
    let patientId = session.patientId;
    if (!patientId) {
        const fallbackPatient = await Patient.findOne({ whatsappNumber: from });
        patientId = fallbackPatient?._id;
        console.log(`⚠️ session.patientId was null, fallback lookup: ${patientId}`);
    }

    if (!patientId) {
        await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });
        return whatsappService.sendButtons(from,
            `❌ Could not find your patient profile. Please try again.`,
            [
                { id: 'consult', title: '🩺 Try again' },
                { id: 'history', title: '📋 My history' }
            ]
        );
    }

    // ── Create the consultation record ────────────────────────────────────────
    const consultation = await Consultation.create({
        patient: patientId,
        doctor: session.data.selectedDoctorId,
        scheduledAt: new Date(Date.now() + 30 * 60 * 1000),
        symptoms: session.data.symptoms || [],
        aiSummary: session.data.aiSummary || null,
        urgency: session.data.urgency || null,
        channel: 'whatsapp',
        status: 'confirmed'
    });

    console.log(`✅ Consultation created: ${consultation._id}`);

    // ── Mark doctor as busy ───────────────────────────────────────────────────
    await Doctor.findByIdAndUpdate(session.data.selectedDoctorId, {
        isAvailableNow: false,
        activeConsultationId: consultation._id
    });

    // ── Fetch patient + doctor details ────────────────────────────────────────
    const [patient, doctor] = await Promise.all([
        Patient.findById(patientId).select('firstName lastName whatsappNumber'),
        Doctor.findById(session.data.selectedDoctorId)
            .select('firstName lastName whatsappNumber phone specialty')
    ]);

    console.log(`👤 Patient: ${patient?.firstName} | 📱 ${patient?.whatsappNumber}`);
    console.log(`👨‍⚕️ Doctor: ${doctor?.firstName} | 📱 WA: ${doctor?.whatsappNumber} | Phone: ${doctor?.phone}`);

    // ── Notify the doctor ─────────────────────────────────────────────────────
    // Normalise number — strip spaces, dashes, leading +
    const rawNumber = doctor?.whatsappNumber || doctor?.phone || '';
    const doctorWhatsapp = rawNumber.replace(/[\s\-\+]/g, '');

    console.log(`📤 Attempting doctor notification to: ${doctorWhatsapp}`);

    if (doctorWhatsapp) {
        try {
            await whatsappService.sendText(doctorWhatsapp,
                `🔔 *New Consultation Booked*\n\n` +
                `👤 *Patient:* ${patient.firstName} ${patient.lastName}\n` +
                `📱 *WhatsApp:* +${patient.whatsappNumber}\n` +
                `🏥 *Specialty:* ${doctor.specialty.replace('_', ' ')}\n` +
                `🤒 *Symptoms:* ${(session.data.symptoms || []).join(', ')}\n` +
                `⚠️ *Urgency:* ${session.data.urgency || 'N/A'}\n` +
                `📋 *Consultation ID:* ${consultation._id}\n\n` +
                `_Please reach out to the patient on WhatsApp to begin the consultation._`
            );
            console.log(`✅ Doctor notification sent to ${doctorWhatsapp}`);
        } catch (notifyErr) {
            // Log but don't crash — patient booking still succeeds
            console.error(`❌ Doctor notification failed: ${notifyErr.message}`);
            console.error(`   Number used: ${doctorWhatsapp}`);
            console.error(`   Meta response:`, notifyErr.response?.data || 'no response data');
        }
    } else {
        console.warn(`⚠️ Doctor has no whatsappNumber or phone on record. ID: ${doctor?._id}`);
    }

    // ── Advance patient session ───────────────────────────────────────────────
    await WaSession.updateOne({ phone: from }, {
        step: 'BOOKING_COMPLETE',
        'data.consultationId': consultation._id
    });

    // ── Confirm to patient ────────────────────────────────────────────────────
    return whatsappService.sendText(from,
        `✅ *Booking Confirmed!*\n\n` +
        `👨‍⚕️ *Doctor:* Dr. ${doctor.firstName} ${doctor.lastName}\n` +
        `🏥 *Specialty:* ${doctor.specialty.replace('_', ' ')}\n` +
        `📋 *Ref:* ${consultation._id}\n\n` +
        `The doctor has been notified and will contact you on WhatsApp shortly.\n\n` +
        `_Type anything to return to the main menu._`
    );
}


async function handleBookingComplete(from, text, session) {
    await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });
    return whatsappService.sendButtons(from, ` *AbcTeleMed Main Menu*\n\n What would you like to do next?`, [
        { id: 'consult', title: '🩺 See a doctor' },
        { id: 'subscribe', title: '💳 Upgrade plan' },
        { id: 'history', title: '📋 My history' }
    ]);
}

// ── subscription handler functions ────

async function handleSubscriptionMenu(from, text, session) {
    const { PLANS, initiateSubscriptionPayment } = require('./paystackService');
    const choice = text?.toLowerCase().trim();

    // If they just arrived at this step, show the plan list
    if (!['plan_basic', 'plan_premium', 'plan_cancel'].includes(choice)) {
        return whatsappService.sendList(from,
            `💳 *Upgrade Your Plan*\n\nChoose a subscription to unlock more features:`,
            'View Plans',
            [
                {
                    id: 'plan_basic',
                    title: 'Basic — ₦950/month',
                    description: PLANS.basic.perks
                },
                {
                    id: 'plan_premium',
                    title: 'Premium — ₦2,500/month',
                    description: PLANS.premium.perks
                },
                {
                    id: 'plan_cancel',
                    title: 'Back to menu',
                    description: 'Return to main menu'
                }
            ]
        );
    }

    if (choice === 'plan_cancel') {
        await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU' });
        return handleMainMenu(from, '', session);
    }

    const plan = choice === 'plan_basic' ? 'basic' : 'premium';
    const patient = await Patient.findOne({ whatsappNumber: from });

    if (patient?.plan === plan) {
        await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU' });
        return whatsappService.sendButtons(from,
            `ℹYou are already on the *${plan}* plan.\n\nYour plan expires: ${patient.planExpiresAt?.toDateString() || 'N/A'}`,
            [
                { id: 'consult', title: '🩺 See a doctor' },
                { id: 'history', title: '📋 My history' }
            ]
        );
    }

    try {
        // Generate Paystack payment link
        const paymentData = await initiateSubscriptionPayment({
            // email: patient.email || `${from}@abctelemed.com`, // fallback if no email yet
            plan,
            patientId: patient._id,
            phone: from
        });

        await WaSession.updateOne({ phone: from }, {
            step: 'PAYMENT_PENDING',
            'data.pendingPlan': plan,
            'data.paymentReference': paymentData.reference
        });

        const planData = PLANS[plan];
        return whatsappService.sendText(from,
            `💳 *Complete Your Payment*\n\n*Plan:* ${planData.name}\n*Amount:* ${planData.label}\n*Perks:* ${planData.perks}\n\n👇 Tap the link below to pay securely:\n\n${paymentData.authorization_url}\n\n_After payment, your plan will be activated automatically. Type *check* to verify your payment status._`
        );
    } catch (err) {
        console.error('❌ Paystack init error:', err.message);
        await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU' });
        return whatsappService.sendText(from,
            `❌ We couldn't generate a payment link right now. Please try again shortly.`
        );
    }
}

async function handlePaymentPending(from, text, session) {
    const { verifyPayment, PLANS } = require('./paystackService');
    const input = text?.toLowerCase().trim();

    if (input !== 'check') {
        return whatsappService.sendText(from,
            `⏳ Waiting for payment confirmation.\n\nOnce you've paid, type *check* to verify your payment.\n\nOr tap the link again if you haven't paid yet.`
        );
    }

    try {
        const reference = session.data?.paymentReference;
        if (!reference) {
            await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU' });
            return handleMainMenu(from, '', session);
        }

        const payment = await verifyPayment(reference);

        if (payment.status === 'success') {
            const plan = session.data.pendingPlan;
            const planData = PLANS[plan];
            const planExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

            await Patient.findOneAndUpdate(
                { whatsappNumber: from },
                { plan, planExpiresAt }
            );
            await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });

            return whatsappService.sendButtons(from,
                `🎉 *Payment confirmed!*\n\n*${planData.name}* is now active until ${planExpiresAt.toDateString()}.\n\n${plan === 'premium' ? '⚡ You now have instant doctor assignment!' : '✅ Basic features unlocked!'}`,
                [
                    { id: 'consult', title: '🩺 See a doctor' },
                    { id: 'history', title: '📋 My history' }
                ]
            );
        } else {
            return whatsappService.sendText(from,
                `⏳ Payment not confirmed yet. Please complete the payment and type *check* again.`
            );
        }
    } catch (err) {
        console.error('❌ Payment verify error:', err.message);
        return whatsappService.sendText(from,
            `❌ Could not verify payment. Please try again or contact support.`
        );
    }
}


async function handleViewHistory(from, text, session) {
    try {
        const patient = await Patient.findOne({ whatsappNumber: from });
        if (!patient) {
            await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU' });
            return whatsappService.sendText(from, `❌ Could not find your profile. Please try again.`);
        }

        const consultations = await Consultation.find({ patient: patient._id })
            .populate('doctor', 'firstName lastName specialty')
            .sort({ scheduledAt: -1 })
            .limit(5);

        if (!consultations.length) {
            await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU' });
            return whatsappService.sendButtons(from,
                `📋 *Consultation History*\n\nYou have no consultations yet.`,
                [
                    { id: 'consult', title: '🩺 See a doctor' },
                    { id: 'subscribe', title: '💳 Upgrade plan' },
                    { id: 'history', title: '📋 My history' }
                ]
            );
        }

        // ── Build history message ───
        const statusEmoji = {
            pending: '🕐',
            confirmed: '✅',
            ongoing: '🔄',
            completed: '✔️',
            cancelled: '❌',
            no_show: '⚠️'
        };

        const lines = consultations.map((c, i) => {
            const emoji = statusEmoji[c.status] || '📋';
            const date = new Date(c.scheduledAt).toLocaleDateString('en-NG', {
                day: 'numeric', month: 'short', year: 'numeric'
            });
            const doctor = c.doctor
                ? `Dr. ${c.doctor.firstName} ${c.doctor.lastName}`
                : 'Unknown Doctor';
            const specialty = c.doctor?.specialty?.replace('_', ' ') || '';
            const symptoms = c.symptoms?.slice(0, 2).join(', ') || 'N/A';

            return (
                `*${i + 1}. ${emoji} ${c.status.toUpperCase()}*\n` +
                `   👨‍⚕️ ${doctor} (${specialty})\n` +
                `   📅 ${date}\n` +
                `   🤒 ${symptoms}` +
                (c.diagnosis ? `\n   🔍 ${c.diagnosis}` : '') +
                (c.prescriptions?.length
                    ? `\n   💊 ${c.prescriptions.map(p => p.medication).join(', ')}`
                    : '')
            );
        });

        const summary =
            `📋 *Your Last ${consultations.length} Consultation(s)*\n\n` +
            lines.join('\n\n') +
            `\n\n_Showing your ${consultations.length} most recent consultation(s)._`;

        await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU' });

        return whatsappService.sendButtons(from,
            summary,
            [
                { id: 'consult', title: '🩺 New consultation' },
                { id: 'subscribe', title: '💳 Upgrade plan' },
                { id: 'history', title: '🔄 Refresh history' }
            ]
        );

    } catch (err) {
        console.error('❌ handleViewHistory error:', err.message);
        await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU' });
        return whatsappService.sendButtons(from,
            `❌ Could not load your history right now. Please try again.`,
            [
                { id: 'consult', title: '🩺 See a doctor' },
                { id: 'history', title: '📋 Try again' },
                { id: 'subscribe', title: '💳 Upgrade plan' }
            ]
        );
    }
}