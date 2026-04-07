const WaSession = require('../models/WaSession');
const Patient = require('../models/Patient');
const wa = require('./whatsappService');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const setStep = (phone, step, extraData = {}) =>
    WaSession.findOneAndUpdate(
        { phone },
        { step, ...extraData },
        { returnDocument: 'after' }
    );

// ─── STEP 1: First message ever from this number ──────────────────────────────
exports.welcome = async (from, session) => {
    // Check if they already registered (e.g. returning user after session expired)
    const existing = await Patient.findOne({ whatsappNumber: from });
    if (existing && existing.isProfileComplete) {
        await setStep(from, 'MAIN_MENU', { patientId: existing._id });
        return wa.sendButtons(from,
            `Welcome back, ${existing.firstName}! 👋\n\nHow can I help you today?`,
            [
                { id: 'consult', title: '🩺 See a doctor' },
                { id: 'history', title: '📋 My history' },
                { id: 'profile', title: '👤 My profile' }
            ]
        );
    }

    // New user — start onboarding
    await setStep(from, 'ASK_FIRST_NAME');
    return wa.sendText(from,
        `👋 Welcome to *ABC Telemedica*!\n\nGet quality healthcare advice and connect with verified doctors right here on WhatsApp.\n\nLet's set up your profile quickly.\n\n*What is your first name?*`
    );
};

// ─── STEP 2: Collect first name ───────────────────────────────────────────────
exports.collectFirstName = async (from, text, session) => {
    const firstName = text?.trim();
    if (!firstName || firstName.length < 2) {
        return wa.sendText(from, `Please enter a valid first name.`);
    }

    await setStep(from, 'ASK_LAST_NAME', { 'data.firstName': firstName });
    return wa.sendText(from, `Nice to meet you, *${firstName}*! \n\nWhat is your last name?`);
};

// ─── STEP 3: Collect last name ────────────────────────────────────────────────
exports.collectLastName = async (from, text, session) => {
    const lastName = text?.trim();
    if (!lastName || lastName.length < 2) {
        return wa.sendText(from, `Please enter a valid last name.`);
    }

    await setStep(from, 'ASK_DOB', { 'data.lastName': lastName });
    return wa.sendText(from,
        `Got it! Now, what is your *date of birth*?\n\nPlease reply in this format: *DD/MM/YYYY*\n_Example: 15/03/1990_`
    );
};

// ─── STEP 4: Collect date of birth ───────────────────────────────────────────
exports.collectDob = async (from, text, session) => {
    const parts = text?.trim().split('/');
    if (parts?.length !== 3) {
        return wa.sendText(from, `❌ Invalid format. Please use *DD/MM/YYYY*\n_Example: 15/03/1990_`);
    }

    const [day, month, year] = parts.map(Number);
    const dob = new Date(year, month - 1, day);
    const age = Math.floor((Date.now() - dob) / (1000 * 60 * 60 * 24 * 365.25));

    if (isNaN(dob.getTime()) || age < 1 || age > 120) {
        return wa.sendText(from, `❌ That doesn't look like a valid date. Please try again using *DD/MM/YYYY*.`);
    }

    await setStep(from, 'ASK_GENDER', { 'data.dob': dob });
    return wa.sendButtons(from,
        `Thanks! What is your *gender*?`,
        [
            { id: 'male', title: 'Male' },
            { id: 'female', title: 'Female' },
            { id: 'prefer_not_to_say', title: 'Prefer not to say' }
        ]
    );
};

// ─── STEP 5: Collect gender ───────────────────────────────────────────────────
exports.collectGender = async (from, text, session) => {
    const validGenders = ['male', 'female', 'prefer_not_to_say'];
    const gender = text?.toLowerCase().trim();

    if (!validGenders.includes(gender)) {
        return wa.sendButtons(from,
            `Please select one of the options below:`,
            [
                { id: 'male', title: 'Male' },
                { id: 'female', title: 'Female' },
                { id: 'prefer_not_to_say', title: 'Prefer not to say' }
            ]
        );
    }

    await setStep(from, 'ASK_STATE', { 'data.gender': gender });
    return wa.sendText(from,
        `Almost done! 🎉\n\nWhich *state* are you based in?\n_Example: Lagos, Abuja, Rivers, Enugu_`
    );
};

// ─── STEP 6: Collect state → save Patient → complete ─────────────────────────
exports.collectState = async (from, text, session) => {
    const state = text?.trim();
    if (!state || state.length < 2) {
        return wa.sendText(from, `Please enter your state. _Example: Lagos_`);
    }

    // Reload fresh session data
    const freshSession = await WaSession.findOne({ phone: from });
    const d = freshSession.data;

    // Create or update Patient record
    const patient = await Patient.findOneAndUpdate(
        { whatsappNumber: from },
        {
            whatsappNumber: from,
            firstName: d.firstName,
            lastName: d.lastName,
            dateOfBirth: d.dob,
            gender: d.gender,
            'location.state': state,
            registrationStep: 'complete',
            isProfileComplete: true
        },
        { upsert: true, returnDocument: 'after', runValidators: true }
    );

    await setStep(from, 'MAIN_MENU', { patientId: patient._id, data: {} });

    return wa.sendButtons(from,
        `✅ *Profile complete, ${patient.firstName}!*\n\nYou're all set. Here's what you can do:`,
        [
            { id: 'consult', title: '🩺 See a doctor' },
            { id: 'history', title: '📋 My history' },
            { id: 'profile', title: '👤 My profile' }
        ]
    );
};
