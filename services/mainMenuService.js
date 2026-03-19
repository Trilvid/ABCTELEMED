const wa = require('./whatsappService');
const WaSession = require('../models/WaSession');

exports.handle = async (from, text, session) => {
    const choice = text?.toLowerCase().trim();

    switch (choice) {
        case 'consult':
            await WaSession.updateOne({ phone: from }, { step: 'SYMPTOM_COLLECT' });
            return wa.sendText(from,
                `🩺 *Start a Consultation*\n\nPlease describe your symptoms in as much detail as you can.\n\n Example: I have a headache, slight fever and body aches since yesterday.`
            );

        case 'history':
            // Will be built in the Consultation module
            return wa.sendText(from, `📋 Your consultation history is coming soon.`);

        case 'profile':
            return wa.sendText(from, `👤 Profile view coming soon.`);

        default:
            return wa.sendButtons(from,
                `Please choose an option:`,
                [
                    { id: 'consult', title: '🩺 See a doctor' },
                    { id: 'history', title: '📋 My history' },
                    { id: 'profile', title: '👤 My profile' }
                ]
            );
    }
};