// // services/botFlowService.js
// const WaSession = require('../models/WaSession');
// const whatsappService = require('./whatsappService');
// const aiService = require('./aiService');
// const onboarding = require('./onboardingService');
// const { collectFirstName, collectLastName, collectDob, collectGender, collectState } = require('./onboardingService');
// const mainMenu = require('./mainMenuService');

// const STEPS = {
//     WELCOME: handleWelcome,
//     // SYMPTOM_COLLECT: handleSymptoms,
//     // TRIAGE: handleTriage,
//     // DOCTOR_MATCH: handleDoctorMatch,

//     // WELCOME: onboarding.welcome(from, session),

//     // ASK_FIRST_NAME: onboarding.collectFirstName(from, text, session),
//     // ASK_LAST_NAME: onboarding.collectLastName(from, text, session),
//     // ASK_DOB: onboarding.collectDob(from, text, session),
//     // ASK_GENDER: onboarding.collectGender(from, text, session),
//     // ASK_STATE: onboarding.collectState(from, text, session),
//     // MAIN_MENU: mainMenu.handle(from, text, session),


//     ASK_FIRST_NAME: collectFirstName(),
//     ASK_LAST_NAME: collectLastName(),
//     ASK_DOB: collectDob(),
//     ASK_GENDER: collectGender(),
//     ASK_STATE: collectState(),
//     MAIN_MENU: mainMenu.handle(),

//     SYMPTOM_COLLECT: handleSymptoms,
//     TRIAGE: handleTriage,
//     DOCTOR_MATCH: handleDoctorMatch,

//     // Booking steps (extend)
//     DOCTOR_SELECTED: handleDoctorSelected,
//     BOOKING_CONFIRM: handleBookingConfirm,
//     BOOKING_COMPLETE: handleBookingComplete,
// };

// exports.processMessage = async ({ from, type, text, message }) => {

//     if (type === 'interactive') {
//         const interactive = message.interactive;
//         text =
//             interactive?.button_reply?.id ||
//             interactive?.list_reply?.id ||
//             text;
//     }

//     let session = await WaSession.findOneAndUpdate(
//         { phone: from },
//         { lastActive: new Date() },
//         { lastMessageAt: new Date() },
//         { upsert: true, new: true }
//     );

//     const handler = STEPS[session.step] || handleWelcome;
//     await handler(from, text, session, message);
// };

// async function handleWelcome(from, text, session) {

//     await whatsappService.sendText(from,
//         `👋 Welcome to *AbcTeleMed*!\n\nI'm here to help you understand your symptoms and connect you with the right doctor.\n\nPlease describe what you're feeling right now:`
//     );
//     await WaSession.updateOne({ phone: from }, { step: 'SYMPTOM_COLLECT' });
// }

// async function handleSymptoms(from, text, session) {
//     const symptoms = [...(session.data.symptoms || []), text];
//     await WaSession.updateOne({ phone: from }, { 'data.symptoms': symptoms });

//     // Ask follow-up or move to AI triage
//     await whatsappService.sendButtons(from,
//         `Got it. Would you like to add more symptoms or proceed to analysis?`,
//         [
//             { id: 'add_more', title: 'Add more' },
//             { id: 'proceed', title: 'Analyse now' }
//         ]
//     );
//     await WaSession.updateOne({ phone: from }, { step: 'TRIAGE' });
// }

// async function handleTriage(from, text, session) {
//     const symptoms = session.data.symptoms;
//     const analysis = await aiService.analyseSymptoms(symptoms);

//     await whatsappService.sendText(from,
//         `🔍 *Based on your symptoms:*\n\n${analysis.summary}\n\n_Recommended next step: ${analysis.recommendation}_`
//     );

//     // If doctor referral needed, pull from your existing doctor API
//     if (analysis.needsDoctor) {
//         await WaSession.updateOne({ phone: from }, { step: 'DOCTOR_MATCH' });
//         await handleDoctorMatch(from, text, session);
//     }
// }

// async function handleDoctorMatch(from, text, session) {
//     // Call YOUR existing doctor API
//     const { data } = await require('axios').get(
//         `${process.env.INTERNAL_API}/doctors/available?specialty=${session.data.specialty}`
//     );
//     const doctors = data.slice(0, 3);

//     const rows = doctors.map(d => ({
//         id: d._id,
//         title: `Dr. ${d.name}`,
//         description: `${d.specialty} • ⭐ ${d.rating}`
//     }));

//     await whatsappService.sendList(from, 'Choose a doctor', 'View Doctors', rows);
// }


// // Booking flow extensions
// async function handleDoctorSelected(from, text, session) {
//     const doctorId = text?.trim();
//     const doctor = await require('../models/Doctor').findById(doctorId);

//     if (!doctor)
//         return whatsappService.sendText(from, `❌ Could not find that doctor. Please try again.`);

//     await WaSession.updateOne({ phone: from }, {
//         step: 'BOOKING_CONFIRM',
//         'data.selectedDoctorId': doctorId
//     });

//     return whatsappService.sendButtons(from,
//         `👨‍⚕️ *Dr. ${doctor.firstName} ${doctor.lastName}*\n🏥 ${doctor.specialty}\n⭐ ${doctor.rating} rating\n💰 ₦${doctor.consultationFee.toLocaleString()}\n\nConfirm your booking?`,
//         [
//             { id: 'confirm_booking', title: '✅ Confirm' },
//             { id: 'cancel_booking', title: '❌ Cancel' }
//         ]
//     );
// }

// async function handleBookingConfirm(from, text, session) {
//     if (text === 'cancel_booking') {
//         await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });
//         return whatsappService.sendButtons(from, `Booking cancelled. What would you like to do?`, [
//             { id: 'consult', title: '🩺 See a doctor' },
//             { id: 'history', title: '📋 My history' }
//         ]);
//     }

//     if (text !== 'confirm_booking')
//         return whatsappService.sendButtons(from, `Please confirm or cancel your booking:`, [
//             { id: 'confirm_booking', title: '✅ Confirm' },
//             { id: 'cancel_booking', title: '❌ Cancel' }
//         ]);

//     const consultation = await require('../models/Consultation').create({
//         patient: session.patientId,
//         doctor: session.data.selectedDoctorId,
//         scheduledAt: new Date(Date.now() + 30 * 60 * 1000), // next available: 30 mins
//         symptoms: session.data.symptoms || [],
//         aiSummary: session.data.aiSummary || null,
//         urgency: session.data.urgency || null,
//         channel: 'whatsapp'
//     });

//     await WaSession.updateOne({ phone: from }, {
//         step: 'BOOKING_COMPLETE',
//         'data.consultationId': consultation._id
//     });

//     return whatsappService.sendText(from,
//         `✅ *Booking Confirmed!*\n\nYour consultation has been booked.\n📋 Ref: *${consultation._id}*\n\nThe doctor will contact you shortly on WhatsApp.\n\n_Type anything to return to the main menu._`
//     );
// }

// async function handleBookingComplete(from, text, session) {
//     await WaSession.updateOne({ phone: from }, { step: 'MAIN_MENU', data: {} });
//     return whatsappService.sendButtons(from, `What would you like to do next?`, [
//         { id: 'consult', title: '🩺 See a doctor' },
//         { id: 'history', title: '📋 My history' },
//         { id: 'profile', title: '👤 My profile' }
//     ]);
// }

// services/botFlowService.js
const WaSession = require('../models/WaSession');
const whatsappService = require('./whatsappService');
const aiService = require('./aiService');
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
    DOCTOR_SELECTED: handleDoctorSelected,
    BOOKING_CONFIRM: handleBookingConfirm,
    BOOKING_COMPLETE: handleBookingComplete,
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

    await whatsappService.sendText(from,
        `🔍 *Based on your symptoms:*\n\n${analysis.summary}\n\n_Recommended next step: ${analysis.recommendation}_`
    );

    // If doctor referral needed, pull from your existing doctor API
    if (analysis.needsDoctor) {
        await WaSession.updateOne({ phone: from }, { step: 'DOCTOR_MATCH' });
        await handleDoctorMatch(from, text, session);
    }
}

async function handleDoctorMatch(from, text, session) {
    // Call YOUR existing doctor API
    const { data } = await require('axios').get(
        `${process.env.INTERNAL_API}/doctors/available?specialty=${session.data.specialty}`
    );
    const doctors = data.slice(0, 3);

    const rows = doctors.map(d => ({
        id: d._id,
        title: `Dr. ${d.name}`,
        description: `${d.specialty} • ⭐ ${d.rating}`
    }));

    await whatsappService.sendList(from, 'Choose a doctor', 'View Doctors', rows);
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

async function handleMainMenu(from, text, session) {
    const choice = text?.toLowerCase().trim();
    if (choice === 'consult') {
        await WaSession.updateOne({ phone: from }, { step: 'SYMPTOM_COLLECT' });
        return whatsappService.sendText(from,
            `🩺 *Start a Consultation*\n\nDescribe your symptoms in as much detail as you can.\n\n_Example: I have a headache, slight fever and body aches since yesterday._`
        );
    }
    if (choice === 'history') {
        return whatsappService.sendText(from, `📋 Consultation history coming soon.`);
    }
    return whatsappService.sendButtons(from, `Please choose an option:`, [
        { id: 'consult', title: '🩺 See a doctor' },
        { id: 'history', title: '📋 My history' },
        { id: 'profile', title: '👤 My profile' }
    ]);
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
        { id: 'history', title: '📋 My history' },
        { id: 'profile', title: '👤 My profile' }
    ]);
}
