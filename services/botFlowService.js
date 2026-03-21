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
        { lastActive: new Date() },
        { lastMessageAt: new Date() },
        { upsert: true, new: true }
    );

    const handler = STEPS[session.step] || handleWelcome;
    await handler(from, text, session, message);
};


async function handleWelcome(from, text, session) {

    await whatsappService.sendText(from,
        `👋 Welcome to *AbcTeleMed*!\n\nI'm here to help you understand your symptoms and connect you with the right doctor.\n\nPlease describe what you're feeling right now:`
    );
    await WaSession.updateOne({ phone: from }, { step: 'SYMPTOM_COLLECT' });
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
        { id: 'prefer_not_to_say', title: 'Prefer not to say' }
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
        await WaSession.updateOne({ phone: from }, { step: 'SYMPTOM_COLLECT', data: {} });
        return whatsappService.sendText(from,
            `🩺 *Start a Consultation*\n\nDescribe your symptoms in as much detail as you can.\n\n_Example: I have a headache, slight fever and body aches since yesterday._`
        );
    }

    if (choice === 'subscribe') {
        await WaSession.updateOne({ phone: from }, { step: 'SUBSCRIPTION_MENU' });
        return handleSubscriptionMenu(from, text, session);
    }

    if (choice === 'history') {
        return whatsappService.sendText(from, `📋 Consultation history coming soon.`);
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
    const doctorId = text?.trim();
    const doctor = await require('../models/Doctor').findById(doctorId);

    if (!doctor)
        return whatsappService.sendText(from, `❌ Could not find that doctor. Please try again.`);

    await WaSession.updateOne({ phone: from }, {
        step: 'BOOKING_CONFIRM',
        'data.selectedDoctorId': doctorId
    });

    return whatsappService.sendButtons(from,
        `👨‍⚕️ *Dr. ${doctor.firstName} ${doctor.lastName}*\n🏥 ${doctor.specialty}\n⭐ ${doctor.rating} rating\n💰 ₦${doctor.consultationFee.toLocaleString()}\n\nConfirm your booking?`,
        [
            { id: 'confirm_booking', title: '✅ Confirm' },
            { id: 'cancel_booking', title: '❌ Cancel' }
        ]
    );
}

async function handleBookingConfirm(from, text, session) {
    if (text === 'cancel_booking') {
        await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });
        return whatsappService.sendButtons(from, `Booking cancelled. What would you like to do?`, [
            { id: 'consult', title: '🩺 See a doctor' },
            { id: 'history', title: '📋 My history' }
        ]);
    }

    if (text !== 'confirm_booking')
        return whatsappService.sendButtons(from, `Please confirm or cancel your booking:`, [
            { id: 'confirm_booking', title: '✅ Confirm' },
            { id: 'cancel_booking', title: '❌ Cancel' }
        ]);

    const consultation = await require('../models/Consultation').create({
        patient: session.patientId,
        doctor: session.data.selectedDoctorId,
        scheduledAt: new Date(Date.now() + 30 * 60 * 1000), // next available: 30 mins
        symptoms: session.data.symptoms || [],
        aiSummary: session.data.aiSummary || null,
        urgency: session.data.urgency || null,
        channel: 'whatsapp'
    });

    await WaSession.updateOne({ phone: from }, {
        step: 'BOOKING_COMPLETE',
        'data.consultationId': consultation._id
    });

    return whatsappService.sendText(from,
        `✅ *Booking Confirmed!*\n\nYour consultation has been booked.\n📋 Ref: *${consultation._id}*\n\nThe doctor will contact you shortly on WhatsApp.\n\n_Type anything to return to the main menu._`
    );
}

async function handleBookingComplete(from, text, session) {
    await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });
    return whatsappService.sendButtons(from, `What would you like to do next?`, [
        { id: 'consult', title: '🩺 See a doctor' },
        { id: 'subscribe', title: '💳 Upgrade plan' },
        { id: 'history', title: '📋 My history' },
        { id: 'profile', title: '👤 My profile' }
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
            `ℹ️ You are already on the *${plan}* plan.\n\nYour plan expires: ${patient.planExpiresAt?.toDateString() || 'N/A'}`,
            [
                { id: 'consult', title: '🩺 See a doctor' },
                { id: 'history', title: '📋 My history' }
            ]
        );
    }

    try {
        // Generate Paystack payment link
        const paymentData = await initiateSubscriptionPayment({
            email: patient.email || `${from}@abctelemed.com`, // fallback if no email yet
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