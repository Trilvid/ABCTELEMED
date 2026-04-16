// services/botFlowService.js
const WaSession = require('../models/WaSession');
const whatsappService = require('./whatsappService');
const aiService = require('./aiService');
const Patient = require('../models/Patient');
const Doctor = require('../models/Doctor');
const Consultation = require('../models/Consultation');
const flutterwaveService = require('./flutterwaveService');

const getPlanBadge = (plan) => {
    if (plan?.startsWith('premium')) return 'Premium';
    if (plan?.startsWith('basic')) return 'Basic';
    return 'Free';
};

const subscriptionRows = (plans) => ([
    { id: 'basic_monthly', title: 'Basic Monthly', description: plans.basic_monthly.label },
    { id: 'basic_annual', title: 'Basic Annual', description: plans.basic_annual.label },
    { id: 'premium_monthly', title: 'Premium Monthly', description: plans.premium_monthly.label },
    { id: 'premium_annual', title: 'Premium Annual', description: plans.premium_annual.label },
    { id: 'cancel', title: 'Back', description: 'Return to menu' }
]);



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
    ASK_COUNTRY: handleAskCountry,
    ASK_STATE: handleAskState,
    MAIN_MENU: handleMainMenu,

    // Booking steps (extend)
    SUBSCRIPTION_MENU: handleSubscriptionMenu,
    PAYMENT_PENDING: handlePaymentPending,

    DOCTOR_SELECTED: handleDoctorSelected,
    BOOKING_CONFIRM: handleBookingConfirm,
    BOOKING_COMPLETE: handleBookingComplete,
    VIEW_HISTORY: handleViewHistory,

    CONSULTATION_PAYMENT: handleConsultationPayment,

    REVIEW_DOCTOR: handleReviewDoctor,
    REVIEW_COMMENT: handleReviewComment,

    PAYMENT_METHOD: handlePaymentMethod,
    USSD_BANK_SELECT: handleUssdBankSelect,
    USSD_WAITING: handleUssdWaiting,
    BANK_TRANSFER_WAITING: handleBankTransferWaiting,

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
        { upsert: true, returnDocument: 'after' }
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
        const normalizedPlanBadge = getPlanBadge(existing.plan);
        return whatsappService.sendButtons(from,
            `Welcome back, *${existing.firstName}*! 👋\n\nPlan: *${normalizedPlanBadge}*\n\nHow can I help you today?`,
            [
                { id: 'consult', title: 'See a doctor' },
                { id: 'subscribe', title: 'Upgrade plan' },
                { id: 'history', title: 'My history' }
            ]
        );
    }

    // ── New user — start onboarding ───────────────────────────────────────────
    await WaSession.updateOne({ phone: from }, { step: 'ASK_FIRST_NAME' });
    return whatsappService.sendText(from,
        `👋 Welcome to *ABC Telemedica*!\n\nGet quality healthcare advice and connect with verified doctors right here on WhatsApp.\n\nLet's set up your profile quickly.\n\n*What is your first name?*`
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

// REPLACE handleTriage
async function handleTriage(from, text, session) {
    const symptoms = session.data.symptoms;
    const analysis = await aiService.analyseSymptoms(symptoms);

    // Save AI result to session
    await WaSession.updateOne({ phone: from }, {
        'data.aiSummary': analysis.summary,
        'data.specialty': analysis.specialty,
        'data.urgency': analysis.urgency,
        step: 'DOCTOR_MATCH'
    });

    await whatsappService.sendText(from,
        `Based on your symptoms:\n\n${analysis.summary}\n\nRecommended next step: ${analysis.recommendation}`
    );

    if (analysis.needsDoctor) {
        // ── Reload session so handleDoctorMatch gets the updated specialty ──
        const freshSession = await WaSession.findOne({ phone: from });
        await handleDoctorMatch(from, text, freshSession);
    } else {
        await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU' });
        await whatsappService.sendButtons(from,
            `Based on your symptoms, you should be fine managing this at home.\n\nIf symptoms worsen, start a new consultation.`,
            [
                { id: 'consult', title: 'See a doctor anyway' },
                { id: 'history', title: 'My history' }
            ]
        );
    }
}


// REPLACE handleDoctorMatch
async function handleDoctorMatch(from, text, session) {
    const patient = await Patient.findOne({ whatsappNumber: from });
    const specialty = session.data?.specialty || 'general_practice';

    console.log(`🔍 Doctor match — specialty: ${specialty} | plan: ${patient?.plan}`);

    // ── PREMIUM: auto-assign ──
    if (patient?.plan === 'premium_monthly' || patient?.plan === 'premium_annual') {
        const doctor = await Doctor.findOne({
            specialty,
            status: 'verified',
            $or: [{ isOnCall: true }, { isAvailableNow: true }]
        }).sort({ rating: -1 });

        console.log(`⚡ Premium auto-assign — doctor found: ${doctor ? doctor.firstName : 'NONE'}`);

        if (doctor) {
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

            await Doctor.findByIdAndUpdate(doctor._id, {
                isAvailableNow: false,
                activeConsultationId: consultation._id
            });

            // Notify doctor
            const doctorNumber = (doctor.whatsappNumber || doctor.phone || '').replace(/[\s\-\+]/g, '');
            console.log(`📤 Notifying doctor at: ${doctorNumber}`);
            if (doctorNumber) {
                try {
                    await whatsappService.sendText(doctorNumber,
                        `New Consultation Assigned\n\n` +
                        `Patient: ${patient.firstName} ${patient.lastName}\n` +
                        `WhatsApp: +${patient.whatsappNumber}\n` +
                        `Symptoms: ${(session.data.symptoms || []).join(', ')}\n` +
                        `Urgency: ${session.data.urgency || 'N/A'}\n` +
                        `Ref: ${consultation._id}\n\n` +
                        `Please contact the patient on WhatsApp to begin.`
                    );
                    console.log(`✅ Doctor notified: ${doctorNumber}`);
                } catch (e) {
                    console.error(`❌ Doctor notify failed: ${e.message}`);
                }
            }

            await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });
            return whatsappService.sendText(from,
                `Doctor Assigned!\n\n` +
                `Dr. ${doctor.firstName} ${doctor.lastName}\n` +
                `Specialty: ${doctor.specialty.replace('_', ' ')}\n` +
                `Ref: ${consultation._id}\n\n` +
                `The doctor will contact you on WhatsApp shortly.\n\nType anything to return to the menu.`
            );
        }

        await whatsappService.sendText(from,
            `No doctors available for instant assignment right now.\n\nShowing available doctors instead:`
        );
    }

    // ── FREE / BASIC: show list 
    const doctors = await Doctor.find({
        specialty,
        status: 'verified',
        isAvailableNow: true
    }).sort({ rating: -1 }).limit(3);

    console.log(`📋 Doctors found for ${specialty}: ${doctors.length}`);

    if (!doctors.length) {
        // ── Fallback: try general_practice if specialty returns nothing ────────
        const fallback = await Doctor.find({
            status: 'verified',
            isAvailableNow: true
        }).sort({ rating: -1 }).limit(3);

        console.log(`📋 Fallback doctors (any specialty): ${fallback.length}`);

        if (!fallback.length) {
            await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });
            return whatsappService.sendButtons(from,
                `No doctors are currently available.\n\nPlease try again in a little while.`,
                [
                    { id: 'consult', title: 'Try again' },
                    { id: 'history', title: 'My history' }
                ]
            );
        }

        const fallbackRows = fallback.map(d => ({
            id: d._id.toString(),
            title: `Dr. ${d.firstName} ${d.lastName}`,
            description: `${d.specialty.replace('_', ' ')} - ${d.rating} rating - N${d.consultationFee.toLocaleString()}`
        }));

        await WaSession.updateOne({ phone: from }, { step: 'DOCTOR_SELECTED' });
        return whatsappService.sendList(from, 'No specialist available. Choose a doctor:', 'View Doctors', fallbackRows);
    }

    const rows = doctors.map(d => ({
        id: d._id.toString(),
        title: `Dr. ${d.firstName} ${d.lastName}`,
        description: `${d.specialty.replace('_', ' ')} - ${d.rating} rating - N${d.consultationFee.toLocaleString()}`
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

    await WaSession.updateOne({ phone: from }, { step: 'ASK_COUNTRY', 'data.gender': gender });
    return whatsappService.sendText(from,
        `Almost done! \n\nWhich *country* are you based in?\n_Example: Nigeria, United Kingdom, United States_`
    );
}

async function handleAskCountry(from, text, session) {
    const country = text?.trim();
    if (!country || country.length < 2)
        return whatsappService.sendText(from, `Please enter your country. _Example: Nigeria_`);

    await WaSession.updateOne({ phone: from }, { step: 'ASK_STATE', 'data.country': country });
    return whatsappService.sendText(from,
        `Got it! Which *state or region* are you in?\n\n_Example: Lagos, Abuja, Rivers, Enugu_`
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
            'location.country': d.country || 'Nigeria',
            'location.state': state,
            isProfileComplete: true
        },
        { upsert: true, returnDocument: 'after' }
    );

    await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', patientId: patient._id, data: {} });
    return whatsappService.sendButtons(from,
        `✅ *Profile complete, ${patient.firstName}!*\n\nHere's what you can do:`,
        [
            { id: 'consult', title: 'See a doctor' },
            { id: 'history', title: 'My history' },
            { id: 'subscribe', title: 'Upgrade plan' }
        ]
    );
}

// ──  handleMainMenu — adds subscription option to the menu ───
async function handleMainMenu(from, text, session) {
    const choice = text?.toLowerCase().trim();

    // if (choice === 'consult') {
    //     const patient = await Patient.findOne({ whatsappNumber: from });

    //     if (!patient?.hasActivePlan()) {
    //         await WaSession.updateOne({ phone: from }, { step: 'SUBSCRIPTION_MENU' });
    //         return handleSubscriptionMenu(from, '', session);
    //     }

    //     // Has active plan — proceed to symptom collection
    //     await WaSession.updateOne({ phone: from }, { step: 'SYMPTOM_COLLECT', data: {} });
    //     return whatsappService.sendText(from,
    //         `*Start a Consultation*\n\nDescribe your symptoms in as much detail as you can.\n\nExample: I have a headache, slight fever and body aches since yesterday.`
    //     );
    // }

    if (choice === 'consult') {
        const patient = await Patient.findOne({ whatsappNumber: from });
        const isTrialMode = process.env.TRIAL_MODE === 'true';

        if (!isTrialMode && !patient?.hasActivePlan()) {
            await WaSession.updateOne({ phone: from }, { step: 'SUBSCRIPTION_MENU' });
            return handleSubscriptionMenu(from, '', session);
        }

        // Trial mode OR has active plan — proceed directly
        await WaSession.updateOne({ phone: from }, { step: 'SYMPTOM_COLLECT', data: {} });
        return whatsappService.sendText(from,
            `*Start a Consultation*\n\nDescribe your symptoms in as much detail as you can.\n\nExample: I have a headache, slight fever and body aches since yesterday.`
        );
    }

    if (choice === 'subscribe') {
        await WaSession.updateOne({ phone: from }, { step: 'SUBSCRIPTION_MENU' });
        return handleSubscriptionMenu(from, '', session);
    }

    if (choice === 'history') {
        await WaSession.updateOne({ phone: from }, { step: 'VIEW_HISTORY' });
        return handleViewHistory(from, text, session);
    }

    // Default — show full main menu
    const patient = await Patient.findOne({ whatsappNumber: from });
    const normalizedPlanBadge = getPlanBadge(patient?.plan);
    return whatsappService.sendButtons(from,
        `🏥 *ABC Telemedica Main Menu*\n\nPlan: *${normalizedPlanBadge}*\n\nHow can we help you today?`,
        [
            { id: 'consult', title: 'See a doctor' },
            { id: 'subscribe', title: 'Upgrade plan' },
            { id: 'history', title: 'My history' }
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

        // ── Valid ObjectId — find the doctor 
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


//  handleBookingConfirm
async function handleBookingConfirm(from, text, session) {
    if (text === 'cancel_booking') {
        await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });
        return whatsappService.sendButtons(from,
            `Booking cancelled. What would you like to do?`,
            [
                { id: 'consult', title: 'See a doctor' },
                { id: 'history', title: 'My history' },
                { id: 'subscribe', title: 'Upgrade plan' }
            ]
        );
    }

    if (text !== 'confirm_booking') {
        return whatsappService.sendButtons(from,
            `Please confirm or cancel your booking:`,
            [
                { id: 'confirm_booking', title: 'Confirm' },
                { id: 'cancel_booking', title: 'Cancel' }
            ]
        );
    }

    // Resolve doctor info
    const doctor = await Doctor.findById(session.data.selectedDoctorId)
        .select('firstName lastName specialty consultationFee');

    if (!doctor) {
        await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });
        return whatsappService.sendText(from, `Could not find that doctor. Please try again.`);
    }

    // Move to payment method selection
    await WaSession.updateOne({ phone: from }, { step: 'PAYMENT_METHOD' });

    return whatsappService.sendList(from,
        `*Dr. ${doctor.firstName} ${doctor.lastName}*\n` +
        `Specialty: ${doctor.specialty.replace(/_/g, ' ')}\n` +
        `Fee: ₦${doctor.consultationFee.toLocaleString()}\n\n` +
        `How would you like to pay?`,
        'Choose payment',
        [
            {
                id: 'pay_ussd',
                title: 'USSD',
                description: 'Dial a code from your phone — no internet needed'
            },
            {
                id: 'pay_transfer',
                title: 'Bank Transfer',
                description: 'Get an account number, transfer from your bank app'
            },
            {
                id: 'pay_link',
                title: 'Card / Other',
                description: 'Pay with card, USSD, or bank via secure link'
            }
        ]
    );
}


async function handleBookingComplete(from, text, session) {
    await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });
    return whatsappService.sendButtons(from, ` *ABC Telemedica Main Menu*\n\n What would you like to do next?`, [
        { id: 'consult', title: '🩺 See a doctor' },
        { id: 'subscribe', title: '💳 Upgrade plan' },
        { id: 'history', title: '📋 My history' }
    ]);
}

// ── subscription handler functions ────

async function handleSubscriptionMenu(from, text, session) {
    const { PLANS, initiateSubscriptionPayment } = require('./flutterwaveService');
    const choice = text?.toLowerCase().trim();

    const validChoices = ['basic_monthly', 'basic_annual', 'premium_monthly', 'premium_annual', 'cancel'];

    if (!validChoices.includes(choice)) {
        return whatsappService.sendList(
            from,
            `Subscribe to access doctor consultations.\n\nChoose a plan below:`,
            'View Plans',
            subscriptionRows(PLANS)
        );
    }

    if (choice === 'cancel') {
        await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU' });
        return handleMainMenu(from, '', session);
    }

    const plan = choice;
    const planData = PLANS[plan];
    const patient = await Patient.findOne({ whatsappNumber: from });

    if (!patient) {
        await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU' });
        return whatsappService.sendText(from, `Could not find your profile. Please try again.`);
    }

    // Guard: already on the same plan and it's still active — don't charge again
    if (patient.plan === plan && patient.hasActivePlan()) {
        await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU' });
        return whatsappService.sendButtons(from,
            `You are already on the *${planData.name}* plan.\n\nExpires: ${new Date(patient.planExpiresAt).toDateString()}\n\nWhat would you like to do?`,
            [
                { id: 'consult', title: 'See a doctor' },
                { id: 'history', title: 'My history' }
            ]
        );
    }

    try {
        const safeEmail = patient.email || `patient${from}@abctelemedica.ng`;

        const paymentData = await initiateSubscriptionPayment({
            email: safeEmail,
            plan,
            patientId: patient._id,
            phone: from
        });

        await WaSession.updateOne({ phone: from }, {
            step: 'PAYMENT_PENDING',
            'data.pendingPlan': plan,
            'data.paymentReference': paymentData.tx_ref,
            'data.paymentLink': paymentData.link,
            'data.paymentInitiatedAt': new Date()
        });

        return whatsappService.sendText(from,
            `*${planData.name}*\n` +
            `Amount: ${planData.label}\n` +
            `Perks: ${planData.perks}\n\n` +
            `Tap the link below to pay securely:\n\n` +
            `${paymentData.link}\n\n` +
            `After payment, type *check* to activate your plan.\n` +
            `If your link expires, type *retry* to get a new one.`
        );
    } catch (err) {
        console.error('Subscription payment init error:', err.message);
        await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU' });
        return whatsappService.sendText(from,
            `Could not generate a payment link right now.\n\nPlease try again shortly or contact support.`
        );
    }
}


async function handlePaymentPending(from, text, session) {
    const { PLANS, initiateSubscriptionPayment, verifyByTxRef } = require('./flutterwaveService');
    const input = text?.toLowerCase().trim();

    const LINK_EXPIRY_MS = 30 * 60 * 1000;
    const initiatedAt = session.data?.paymentInitiatedAt;
    const isStale = initiatedAt && (Date.now() - new Date(initiatedAt).getTime()) > LINK_EXPIRY_MS;

    // ── Retry ───
    if (input === 'retry' || isStale) {
        const plan = session.data?.pendingPlan;
        if (!plan) {
            await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU' });
            return handleMainMenu(from, '', session);
        }
        const patient = await Patient.findOne({ whatsappNumber: from });
        if (!patient) {
            await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU' });
            return whatsappService.sendText(from, `Could not find your profile. Type anything to return.`);
        }
        try {
            const safeEmail = patient.email || `patient${from}@abctelemedica.ng`;
            const paymentData = await initiateSubscriptionPayment({
                email: safeEmail,
                plan,
                patientId: patient._id,
                phone: from
            });
            await WaSession.updateOne({ phone: from }, {
                'data.paymentReference': paymentData.tx_ref,
                'data.paymentLink': paymentData.link,
                'data.paymentInitiatedAt': new Date()
            });
            return whatsappService.sendText(from,
                `Here is a fresh payment link:\n\n${paymentData.link}\n\nAfter payment, type *check* to activate your plan.`
            );
        } catch (err) {
            console.error('Subscription retry error:', err.message);
            return whatsappService.sendText(from, `Could not generate a new link right now. Please try again shortly.`);
        }
    }

    // ── Not "check" ───
    if (input !== 'check') {
        const existingLink = session.data?.paymentLink;
        return whatsappService.sendText(from,
            `Waiting for payment confirmation.\n\n` +
            (existingLink ? `Your payment link:\n${existingLink}\n\n` : '') +
            `Once you have paid, type *check* to verify.\n` +
            `If your link expired, type *retry* to get a new one.`
        );
    }

    // ── Verify payment ───
    try {
        const tx_ref = session.data?.paymentReference;
        const plan = session.data?.pendingPlan;
        if (!tx_ref || !plan) {
            await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU' });
            return handleMainMenu(from, '', session);
        }

        const transaction = await verifyByTxRef(tx_ref);

        // FIX: Flutterwave transactions list returns 'success', webhook uses 'successful'
        const isPaid = transaction?.status === 'successful' || transaction?.status === 'success';

        if (isPaid) {
            const planData = PLANS[plan];
            const daysToAdd = planData.billing === 'annual' ? 365 : 30;
            const planExpiresAt = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000);

            await Patient.findOneAndUpdate(
                { whatsappNumber: from },
                { plan, planExpiresAt },
                { runValidators: true }
            );
            await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });

            const isPremium = plan.startsWith('premium');
            return whatsappService.sendButtons(from,
                `Payment confirmed!\n\n*${planData.name}* is now active until ${planExpiresAt.toDateString()}.\n\n${isPremium ? 'You now have instant doctor assignment.' : 'You can now access doctor consultations.'}`,
                [
                    { id: 'consult', title: 'See a doctor' },
                    { id: 'history', title: 'My history' },
                    { id: 'subscribe', title: 'My plan' }
                ]
            );
        } else {
            return whatsappService.sendText(from,
                `Payment not confirmed yet.\n\nPlease complete the payment and type *check* again.\n\nIf your link expired, type *retry* to get a new one.`
            );
        }
    } catch (err) {
        console.error('Payment verify error:', err.message);
        return whatsappService.sendText(from,
            `Could not verify payment right now. Please try again in a moment or contact support.`
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

async function handleConsultationPayment(from, text, session) {
    const input = text?.toLowerCase().trim();
    const LINK_EXPIRY_MS = 30 * 60 * 1000;
    const initiatedAt = session.data?.paymentInitiatedAt;
    const isStale = initiatedAt && (Date.now() - new Date(initiatedAt).getTime()) > LINK_EXPIRY_MS;

    if (input === 'cancel') {
        await WaSession.updateOne({ phone: from }, { step: 'PAYMENT_METHOD' });
        return handlePaymentMethod(from, '', session);
    }

    if (input === 'retry' || isStale) {
        const doctorId = session.data?.selectedDoctorId;
        const consultationFee = session.data?.consultationFee;
        if (!doctorId || !consultationFee) {
            await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });
            return whatsappService.sendText(from, `Session expired. Please start again.`);
        }
        const patient = await Patient.findOne({ whatsappNumber: from });
        try {
            const { initiateConsultationPayment } = require('./flutterwaveService');
            const paymentData = await initiateConsultationPayment({
                email: patient?.email,
                amount: consultationFee,
                patientId: patient?._id,
                doctorId,
                consultationRef: `${patient?._id}-${Date.now()}`,
                phone: from
            });
            await WaSession.updateOne({ phone: from }, {
                'data.paymentReference': paymentData.tx_ref,
                'data.paymentLink': paymentData.link,
                'data.paymentInitiatedAt': new Date()
            });
            return whatsappService.sendText(from,
                `Fresh link:\n\n${paymentData.link}\n\nType *check* after payment.`
            );
        } catch (err) {
            return whatsappService.sendText(from, `Could not refresh link. Try *cancel* to pick another payment method.`);
        }
    }

    if (input !== 'check') {
        const existingLink = session.data?.paymentLink;
        return whatsappService.sendText(from,
            `Waiting for payment.\n\n` +
            (existingLink ? `Link: ${existingLink}\n\n` : '') +
            `Type *check* to confirm after payment.\n` +
            `Type *retry* for a new link.\nType *cancel* to pick a different payment method.`
        );
    }

    return await _verifyAndFinalize(from, session);
}



// ─── CHANGE 5: handleReviewDoctor (NEW — add at bottom of file) ──────────────

async function handleReviewDoctor(from, text, session) {
    const input = text?.toLowerCase().trim();
    const validRatings = ['review_1', 'review_2', 'review_3', 'review_4', 'review_5'];

    if (input === 'review_skip') {
        await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });
        return whatsappService.sendButtons(from,
            `No problem! Thank you for using ABC Telemedica. 😊`,
            [
                { id: 'consult', title: 'See a doctor' },
                { id: 'history', title: 'My history' },
                { id: 'subscribe', title: 'Upgrade plan' }
            ]
        );
    }

    if (!validRatings.includes(input)) {
        // Re-prompt — patient may have typed something random
        return whatsappService.sendButtons(from,
            `Please rate your consultation with *${session.data.reviewDoctorName || 'your doctor'}*:`,
            [
                { id: 'review_1', title: '⭐ 1 - Poor' },
                { id: 'review_2', title: '⭐⭐ 2 - Fair' },
                { id: 'review_3', title: '⭐⭐⭐ 3 - Good' }
            ]
        );
    }

    const rating = parseInt(input.replace('review_', ''), 10); // 1–5

    // Save rating to session, move to comment step
    await WaSession.updateOne({ phone: from }, {
        step: 'REVIEW_COMMENT',
        'data.reviewRating': rating
    });

    return whatsappService.sendButtons(from,
        `${'⭐'.repeat(rating)} *${rating}/5* — thanks!\n\nWould you like to leave a short comment for the doctor?`,
        [
            { id: 'review_comment_yes', title: 'Add a comment' },
            { id: 'review_comment_skip', title: 'Skip' }
        ]
    );
}


// ─── HandleReviewComment ──────
async function handleReviewComment(from, text, session) {
    const input = text?.trim();
    const lower = input?.toLowerCase();

    // ── Case 1: Patient chose "Skip" ───
    if (lower === 'review_comment_skip') {
        return await saveReview(from, session, null);
    }

    // ── Case 2: Patient chose "Add a comment" ────
    if (lower === 'review_comment_yes') {
        await WaSession.updateOne({ phone: from }, { 'data.awaitingComment': true });
        return whatsappService.sendText(from,
            `Please type your comment below and send it.\n\n_Keep it brief — what made this consultation stand out, good or bad?_`
        );
    }

    // ── Case 3: awaitingComment is true — this IS the typed comment ───────
    if (session.data?.awaitingComment) {
        const comment = input?.length >= 2 ? input : null;
        return await saveReview(from, session, comment);
    }

    // ── Fallback: re-prompt (user typed something unexpected) ─────────────
    return whatsappService.sendButtons(from,
        `Would you like to leave a comment for the doctor?`,
        [
            { id: 'review_comment_yes', title: 'Add a comment' },
            { id: 'review_comment_skip', title: 'Skip' }
        ]
    );
}

// ── Shared save logic extracted so both skip and comment paths use it ────
async function saveReview(from, session, comment) {
    try {
        const consultationId = session.data.reviewConsultationId;
        const rating = session.data.reviewRating;

        if (!consultationId || !rating) {
            await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });
            return handleMainMenu(from, '', session);
        }

        const consultation = await Consultation.findByIdAndUpdate(
            consultationId,
            { review: { rating, comment, reviewedAt: new Date() } },
            { new: true }
        );

        if (consultation?.doctor) {
            const allReviews = await Consultation.find({
                doctor: consultation.doctor,
                'review.rating': { $exists: true, $ne: null }
            }).select('review.rating');

            const totalReviews = allReviews.length;
            const avgRating = totalReviews > 0
                ? allReviews.reduce((sum, c) => sum + c.review.rating, 0) / totalReviews
                : 0;

            await Doctor.findByIdAndUpdate(consultation.doctor, {
                rating: Math.round(avgRating * 10) / 10,
                totalReviews,
            });
        }

        await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });

        return whatsappService.sendButtons(from,
            `✅ Review submitted! Thank you — your feedback helps us improve.\n\nWhat would you like to do next?`,
            [
                { id: 'consult', title: 'See a doctor' },
                { id: 'history', title: 'My history' },
                { id: 'subscribe', title: 'Upgrade plan' }
            ]
        );
    } catch (err) {
        console.error('❌ saveReview error:', err.message);
        await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });
        return whatsappService.sendButtons(from,
            `Your review could not be saved right now. Thank you for using ABC Telemedica!`,
            [
                { id: 'consult', title: 'See a doctor' },
                { id: 'history', title: 'My history' }
            ]
        );
    }
}


// ─── CHANGE 4: handlePaymentMethod ───────────────────────────────────────────
// Routes patient to the chosen payment flow.

async function handlePaymentMethod(from, text, session) {
    const choice = text?.toLowerCase().trim();

    let patientId = session.patientId;
    if (!patientId) {
        const p = await Patient.findOne({ whatsappNumber: from });
        patientId = p?._id;
    }
    if (!patientId) {
        await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });
        return whatsappService.sendText(from, `Could not find your profile. Please try again.`);
    }

    const [patient, doctor] = await Promise.all([
        Patient.findById(patientId).select('firstName lastName email'),
        Doctor.findById(session.data.selectedDoctorId).select('firstName lastName specialty consultationFee')
    ]);

    if (!doctor) {
        await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });
        return whatsappService.sendText(from, `That doctor is no longer available. Please try again.`);
    }

    // ── Card / Standard link ──────────────────────────────────────────────────
    if (choice === 'pay_link') {
        try {
            const { initiateConsultationPayment } = require('./flutterwaveService');
            const safeEmail = patient.email || `patient${from}@abctelemedica.ng`;
            const paymentData = await initiateConsultationPayment({
                email: safeEmail,
                amount: doctor.consultationFee,
                patientId,
                doctorId: session.data.selectedDoctorId,
                consultationRef: `${patientId}-${Date.now()}`,
                phone: from
            });
            await WaSession.updateOne({ phone: from }, {
                step: 'CONSULTATION_PAYMENT',
                'data.paymentReference': paymentData.tx_ref,
                'data.paymentLink': paymentData.link,
                'data.paymentInitiatedAt': new Date(),
                'data.consultationFee': doctor.consultationFee
            });
            return whatsappService.sendText(from,
                `💳 *Secure payment link*\n\n` +
                `Dr. ${doctor.firstName} ${doctor.lastName}\n` +
                `Fee: ₦${doctor.consultationFee.toLocaleString()}\n\n` +
                `${paymentData.link}\n\n` +
                `Tap the link, complete payment, then type *check* here to confirm.\n` +
                `Link expired? Type *retry*.`
            );
        } catch (err) {
            console.error('Payment link error:', err.message);
            return whatsappService.sendText(from, `Could not generate payment link. Please try USSD or Bank Transfer instead.`);
        }
    }

    // ── Bank Transfer ─────────────────────────────────────────────────────────
    if (choice === 'pay_transfer') {
        try {
            const { initiateBankTransferPayment } = require('./flutterwaveService');
            const safeEmail = patient.email || `patient${from}@abctelemedica.ng`;
            const transferData = await initiateBankTransferPayment({
                email: safeEmail,
                amount: doctor.consultationFee,
                patientId,
                doctorId: session.data.selectedDoctorId,
                consultationRef: `${patientId}-${Date.now()}`,
                phone: from,
                fullname: `${patient.firstName || ''} ${patient.lastName || ''}`.trim()
            });

            await WaSession.updateOne({ phone: from }, {
                step: 'BANK_TRANSFER_WAITING',
                'data.paymentReference': transferData.tx_ref,
                'data.paymentInitiatedAt': new Date(),
                'data.consultationFee': doctor.consultationFee,
                'data.bankAccountNumber': transferData.accountNumber,
                'data.bankName': transferData.bankName,
                'data.bankAccountName': transferData.accountName,
            });

            return whatsappService.sendText(from,
                `🏦 *Bank Transfer Details*\n\n` +
                `Bank: *${transferData.bankName}*\n` +
                `Account: *${transferData.accountNumber}*\n` +
                `Account Name: *${transferData.accountName}*\n` +
                `Amount: *₦${doctor.consultationFee.toLocaleString()}*\n\n` +
                `Transfer this exact amount from your mobile banking app.\n\n` +
                `Once sent, type *check* and we will confirm automatically.\n\n` +
                `_Note: Use the exact amount — any difference may delay confirmation._`
            );
        } catch (err) {
            console.error('Bank transfer error:', err.message);
            return whatsappService.sendText(from,
                `Could not create a transfer account right now. Please use USSD or the payment link instead.\n\nType *ussd* for USSD or *link* for a payment link.`
            );
        }
    }

    // ── USSD — ask for bank ───────────────────────────────────────────────────
    if (choice === 'pay_ussd') {
        await WaSession.updateOne({ phone: from }, {
            step: 'USSD_BANK_SELECT',
            'data.consultationFee': doctor.consultationFee
        });

        const { NIGERIAN_BANKS } = require('./flutterwaveService');
        const bankRows = Object.entries(NIGERIAN_BANKS).slice(0, 10).map(([code, bank]) => ({
            id: `bank_${code}`,
            title: bank.name,
            description: `Pay via USSD`
        }));

        return whatsappService.sendList(from,
            `📱 *USSD Payment*\n\nSelect your bank to get a code to dial:`,
            'Select bank',
            bankRows
        );
    }

    // Unknown choice — re-prompt
    return whatsappService.sendList(from,
        `Please choose your payment method:`,
        'Choose payment',
        [
            { id: 'pay_ussd', title: 'USSD', description: 'Dial a code — no internet needed' },
            { id: 'pay_transfer', title: 'Bank Transfer', description: 'Get an account number to transfer to' },
            { id: 'pay_link', title: 'Card / Other', description: 'Pay via secure link' },
        ]
    );
}


// ─── CHANGE 5: handleUssdBankSelect ──────────────────────────────────────────
// Patient selected their bank — initiate USSD charge and show the dial code.

async function handleUssdBankSelect(from, text, session) {
    const { NIGERIAN_BANKS, initiateUssdPayment } = require('./flutterwaveService');

    const input = text?.toLowerCase().trim();
    // Expect format: bank_044, bank_058, etc.
    if (!input.startsWith('bank_')) {
        const bankRows = Object.entries(NIGERIAN_BANKS).slice(0, 10).map(([code, bank]) => ({
            id: `bank_${code}`,
            title: bank.name,
            description: `Pay via USSD`
        }));
        return whatsappService.sendList(from, `Please select your bank:`, 'Select bank', bankRows);
    }

    const bankCode = input.replace('bank_', '');
    const bankInfo = NIGERIAN_BANKS[bankCode];
    if (!bankInfo) {
        return whatsappService.sendText(from, `Bank not found. Please try again.`);
    }

    let patientId = session.patientId;
    if (!patientId) {
        const p = await Patient.findOne({ whatsappNumber: from });
        patientId = p?._id;
    }

    const [patient, doctor] = await Promise.all([
        Patient.findById(patientId).select('firstName lastName email'),
        Doctor.findById(session.data.selectedDoctorId).select('firstName lastName specialty consultationFee')
    ]);

    if (!doctor) {
        await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });
        return whatsappService.sendText(from, `Doctor no longer available. Please start again.`);
    }

    try {
        const ussdData = await initiateUssdPayment({
            email: patient?.email,
            amount: doctor.consultationFee,
            patientId,
            doctorId: session.data.selectedDoctorId,
            consultationRef: `${patientId}-${Date.now()}`,
            phone: from,
            bankCode,
            fullname: `${patient?.firstName || ''} ${patient?.lastName || ''}`.trim()
        });

        await WaSession.updateOne({ phone: from }, {
            step: 'USSD_WAITING',
            'data.paymentReference': ussdData.tx_ref,
            'data.paymentInitiatedAt': new Date(),
            'data.consultationFee': doctor.consultationFee,
            'data.ussdCode': ussdData.ussdString,
            'data.ussdBank': bankInfo.name,
        });

        return whatsappService.sendText(from,
            `📱 *Dial this USSD code to pay*\n\n` +
            `${ussdData.ussdString || 'Code generation in progress...'}\n\n` +
            `Bank: *${bankInfo.name}*\n` +
            `Amount: *₦${doctor.consultationFee.toLocaleString()}*\n\n` +
            `*Steps:*\n` +
            `1. Exit WhatsApp\n` +
            `2. Dial the code above\n` +
            `3. Follow the prompts on your phone\n` +
            `4. Come back here and type *check*\n\n` +
            `${ussdData.instruction ? `_${ussdData.instruction}_\n\n` : ''}` +
            `Type *cancel* to choose a different payment method.`
        );
    } catch (err) {
        console.error('USSD bank select error:', err.message);
        // Fallback: offer other methods
        await WaSession.updateOne({ phone: from }, { step: 'PAYMENT_METHOD' });
        return whatsappService.sendList(from,
            `Could not initiate USSD for ${bankInfo.name}. Please choose another method:`,
            'Choose payment',
            [
                { id: 'pay_transfer', title: 'Bank Transfer', description: 'Get an account number' },
                { id: 'pay_link', title: 'Card / Other', description: 'Pay via secure link' },
            ]
        );
    }
}


// ─── CHANGE 6: handleUssdWaiting ─────────────────────────────────────────────
// Patient has dialled the USSD code — waiting for them to type "check".

async function handleUssdWaiting(from, text, session) {
    const input = text?.toLowerCase().trim();

    if (input === 'cancel') {
        await WaSession.updateOne({ phone: from }, { step: 'PAYMENT_METHOD' });
        return handlePaymentMethod(from, '', session);
    }

    if (input !== 'check') {
        const code = session.data?.ussdCode;
        return whatsappService.sendText(from,
            `Waiting for your USSD payment.\n\n` +
            (code ? `Dial: *${code}*\n\n` : '') +
            `Once done, type *check* to confirm.\n\nType *cancel* to choose a different payment method.`
        );
    }

    return await _verifyAndFinalize(from, session);
}


// ─── CHANGE 7: handleBankTransferWaiting ─────────────────────────────────────

async function handleBankTransferWaiting(from, text, session) {
    const input = text?.toLowerCase().trim();

    if (input === 'cancel') {
        await WaSession.updateOne({ phone: from }, { step: 'PAYMENT_METHOD' });
        return handlePaymentMethod(from, '', session);
    }

    if (input !== 'check') {
        const { bankName, bankAccountNumber, bankAccountName, consultationFee } = session.data;
        return whatsappService.sendText(from,
            `Waiting for your bank transfer.\n\n` +
            `Bank: *${bankName || '—'}*\n` +
            `Account: *${bankAccountNumber || '—'}*\n` +
            `Name: *${bankAccountName || '—'}*\n` +
            `Amount: *₦${Number(consultationFee || 0).toLocaleString()}*\n\n` +
            `Once transferred, type *check* to confirm.\n\nType *cancel* to choose a different method.`
        );
    }

    return await _verifyAndFinalize(from, session);
}

async function _verifyAndFinalize(from, session) {
    const { verifyPaymentFull } = require('./flutterwaveService');

    try {
        const tx_ref = session.data?.paymentReference;
        if (!tx_ref) {
            await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });
            return handleMainMenu(from, '', session);
        }

        const transaction = await verifyPaymentFull(tx_ref, session.data?.flw_transaction_id);
        const isPaid = transaction?.status === 'successful' || transaction?.status === 'success';

        if (!isPaid) {
            // Give a clear message depending on payment method
            const method = session.step === 'USSD_WAITING' ? 'USSD payment'
                : session.step === 'BANK_TRANSFER_WAITING' ? 'bank transfer'
                    : 'payment';
            return whatsappService.sendText(from,
                `Your ${method} has not been confirmed yet.\n\n` +
                `Please complete the payment and type *check* again.\n\n` +
                `_If you're sure you've paid, please wait 2–3 minutes and try again. Bank transfers can take a few minutes to reflect._\n\n` +
                `Type *cancel* to choose a different method.`
            );
        }

        // Payment confirmed — check for idempotency (webhook may have already created it)
        const patient = await Patient.findOne({ whatsappNumber: from });
        if (!patient) {
            await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });
            return handleMainMenu(from, '', session);
        }

        const existing = await Consultation.findOne({
            patient: patient._id,
            paystackReference: tx_ref,
            isPaid: true
        });

        if (!existing) {
            const doctorId = session.data?.selectedDoctorId;
            const doctor = await Doctor.findById(doctorId)
                .select('firstName lastName specialty consultationFee whatsappNumber phone');

            if (doctor) {
                const consultation = await Consultation.create({
                    patient: patient._id,
                    doctor: doctor._id,
                    scheduledAt: new Date(Date.now() + 30 * 60 * 1000),
                    symptoms: session.data?.symptoms || [],
                    aiSummary: session.data?.aiSummary || null,
                    urgency: session.data?.urgency || null,
                    status: 'confirmed',
                    isPaid: true,
                    fee: doctor.consultationFee,
                    channel: 'whatsapp',
                    paystackReference: tx_ref
                });

                await Doctor.findByIdAndUpdate(doctor._id, {
                    isAvailableNow: false,
                    activeConsultationId: consultation._id
                });

                // Notify doctor
                const doctorNumber = (doctor.whatsappNumber || doctor.phone || '').replace(/[\s\-\+]/g, '');
                if (doctorNumber) {
                    try {
                        await whatsappService.sendText(doctorNumber,
                            `New Paid Consultation\n\n` +
                            `Patient: ${patient.firstName} ${patient.lastName || ''}\n` +
                            `WhatsApp: +${patient.whatsappNumber}\n` +
                            `Specialty: ${doctor.specialty.replace(/_/g, ' ')}\n` +
                            `Symptoms: ${(session.data?.symptoms || []).join(', ') || 'N/A'}\n` +
                            `Urgency: ${session.data?.urgency || 'N/A'}\n` +
                            `Fee paid: ₦${doctor.consultationFee.toLocaleString()}\n` +
                            `Ref: ${consultation._id}\n\n` +
                            `Please contact the patient on WhatsApp to begin.`
                        );
                        console.log(`✅ Doctor notified: ${doctorNumber}`);
                    } catch (e) {
                        console.error(`❌ Doctor notify failed: ${e.message}`);
                    }
                }
            }
        }

        await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });
        return whatsappService.sendButtons(from,
            `✅ *Payment confirmed!*\n\nYour doctor has been notified and will contact you on WhatsApp shortly.\n\nIf you don't hear from them within 5 minutes, please contact support.`,
            [
                { id: 'history', title: 'My history' },
                { id: 'consult', title: 'New consultation' },
                { id: 'subscribe', title: 'My plan' }
            ]
        );

    } catch (err) {
        console.error('❌ _verifyAndFinalize error:', err.message);
        return whatsappService.sendText(from,
            `Could not verify your payment right now. Please try again in a moment or contact support.`
        );
    }
}