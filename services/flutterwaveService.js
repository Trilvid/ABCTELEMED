// const axios = require('axios');

// const FLUTTERWAVE_SECRET = process.env.FLUTTERWAVE_SECRET_KEY;
// const BASE_URL = 'https://api.flutterwave.com/v3';

// const PLANS = {
//     basic_monthly: {
//         name: 'Basic Monthly',
//         amount: 750,
//         label: 'N750/month',
//         perks: 'Unlimited symptom checks and doctor referrals',
//         billing: 'monthly'
//     },
//     basic_annual: {
//         name: 'Basic Annual',
//         amount: 6000,
//         label: 'N500/month billed annually',
//         perks: 'Unlimited symptom checks and doctor referrals',
//         billing: 'annual'
//     },
//     premium_monthly: {
//         name: 'Premium Monthly',
//         amount: 1500,
//         label: 'N1,500/month',
//         perks: 'Instant doctor assignment and priority queue',
//         billing: 'monthly'
//     },
//     premium_annual: {
//         name: 'Premium Annual',
//         amount: 14400,
//         label: 'N1,200/month billed annually',
//         perks: 'Instant doctor assignment and priority queue',
//         billing: 'annual'
//     }
// };

// exports.PLANS = PLANS;

// exports.initiateSubscriptionPayment = async ({ email, plan, patientId, phone }) => {
//     const planData = PLANS[plan];
//     if (!planData) throw new Error(`Invalid plan: ${plan}`);
//     if (!FLUTTERWAVE_SECRET) throw new Error('Missing FLUTTERWAVE_SECRET_KEY');
//     if (!process.env.APP_URL) throw new Error('Missing APP_URL');

//     const safeEmail = email && email.includes('@') && !email.includes('@abctelemedica.com')
//         ? email
//         : `patient${phone}@abctelemedica.ng`;

//     const tx_ref = `sub_${patientId}_${Date.now()}`;
//     console.log(`Initiating Flutterwave for plan: ${plan} | email: ${safeEmail} | amount: ${planData.amount}`);

//     try {
//         const response = await axios.post(
//             `${BASE_URL}/payments`,
//             {
//                 tx_ref,
//                 amount: planData.amount,
//                 currency: 'NGN',
//                 redirect_url: `${process.env.APP_URL}/api/flutterwave/webhook/callback`,
//                 customer: {
//                     email: safeEmail,
//                     phone_number: phone
//                 },
//                 meta: {
//                     patientId: patientId.toString(),
//                     phone,
//                     plan,
//                     type: 'subscription'
//                 },
//                 customizations: {
//                     title: `AbcTeleMed — ${planData.name}`,
//                     description: planData.perks
//                 }
//             },
//             {
//                 headers: {
//                     Authorization: `Bearer ${FLUTTERWAVE_SECRET}`,
//                     'Content-Type': 'application/json'
//                 }
//             }
//         );

//         return { ...response.data.data, tx_ref };
//     } catch (err) {
//         console.error('Flutterwave full error:', JSON.stringify(err.response?.data || err.message));
//         throw err;
//     }
// };

// exports.verifyPayment = async (transactionId) => {
//     if (!FLUTTERWAVE_SECRET) throw new Error('Missing FLUTTERWAVE_SECRET_KEY');
//     const response = await axios.get(
//         `${BASE_URL}/transactions/${transactionId}/verify`,
//         {
//             headers: { Authorization: `Bearer ${FLUTTERWAVE_SECRET}` }
//         }
//     );

//     return response.data.data;
// };

// // Verify by tx_ref (what we store in session at initiation time)
// exports.verifyByTxRef = async (tx_ref) => {
//     if (!FLUTTERWAVE_SECRET) throw new Error('Missing FLUTTERWAVE_SECRET_KEY');
//     const response = await axios.get(
//         `${BASE_URL}/transactions?tx_ref=${encodeURIComponent(tx_ref)}`,
//         {
//             headers: { Authorization: `Bearer ${FLUTTERWAVE_SECRET}` }
//         }
//     );
//     const transactions = response.data.data;
//     if (!transactions || transactions.length === 0) return null;
//     return transactions[0]; // most recent match
// };

// exports.initiateConsultationPayment = async ({ email, amount, patientId, doctorId, consultationRef, phone }) => {
//     if (!FLUTTERWAVE_SECRET) throw new Error('Missing FLUTTERWAVE_SECRET_KEY');
//     if (!process.env.APP_URL) throw new Error('Missing APP_URL');

//     const safeEmail = email && email.includes('@') && !email.includes('@abctelemedica.com')
//         ? email
//         : `patient${phone}@abctelemedica.ng`;

//     const tx_ref = `consult_${consultationRef}_${Date.now()}`;
//     console.log(`Initiating consultation payment — amount: ${amount} | email: ${safeEmail}`);

//     try {
//         const response = await axios.post(
//             `${BASE_URL}/payments`,
//             {
//                 tx_ref,
//                 amount, // Flutterwave accepts Naira directly
//                 currency: 'NGN',
//                 redirect_url: `${process.env.APP_URL}/api/flutterwave/webhook/callback`,
//                 customer: {
//                     email: safeEmail,
//                     phone_number: phone
//                 },
//                 meta: {
//                     patientId: patientId.toString(),
//                     doctorId: doctorId.toString(),
//                     consultationRef: consultationRef.toString(),
//                     phone,
//                     type: 'consultation'
//                 },
//                 customizations: {
//                     title: 'AbcTeleMed — Consultation Payment',
//                     description: 'Doctor consultation fee'
//                 }
//             },
//             {
//                 headers: {
//                     Authorization: `Bearer ${FLUTTERWAVE_SECRET}`,
//                     'Content-Type': 'application/json'
//                 }
//             }
//         );
//         return { ...response.data.data, tx_ref };
//     } catch (err) {
//         console.error('Flutterwave consultation init error:', JSON.stringify(err.response?.data || err.message));
//         throw err;
//     }
// };

// services/flutterwaveService.js — COMPLETE REPLACEMENT
const axios = require('axios');

const FLUTTERWAVE_SECRET = process.env.FLUTTERWAVE_SECRET_KEY;
const BASE_URL = 'https://api.flutterwave.com/v3';

// ── Nigerian bank codes for USSD ──────────────────────────────────────────────
const NIGERIAN_BANKS = {
    '044': { name: 'Access Bank', ussd: (code) => `*901*000*${code}#` },
    '058': { name: 'GTBank', ussd: (code) => `*737*000*${code}#` },
    '011': { name: 'First Bank', ussd: (code) => `*894*${code}#` },
    '032': { name: 'Union Bank', ussd: (code) => `*826*${code}#` },
    '033': { name: 'UBA', ussd: (code) => `*919*${code}#` },
    '057': { name: 'Zenith Bank', ussd: (code) => `*966*${code}#` },
    '068': { name: 'Standard Chartered', ussd: (code) => `*909*${code}#` },
    '221': { name: 'Stanbic IBTC', ussd: (code) => `*909*${code}#` },
    '070': { name: 'Fidelity Bank', ussd: (code) => `*770*${code}#` },
    '214': { name: 'First City Monument Bank (FCMB)', ussd: (code) => `*329*${code}#` },
    '076': { name: 'Polaris Bank', ussd: (code) => `*833*${code}#` },
    '035': { name: 'Wema Bank', ussd: (code) => `*945*${code}#` },
    '215': { name: 'Unity Bank', ussd: (code) => `*7799*${code}#` },
    '301': { name: 'Jaiz Bank', ussd: (code) => `*389*${code}#` },
};

const PLANS = {
    basic_monthly: { name: 'Basic Monthly', amount: 50, label: 'N50/month', perks: 'Unlimited symptom checks and doctor referrals', billing: 'monthly' },
    basic_annual: { name: 'Basic Annual', amount: 6000, label: 'N500/month billed annually', perks: 'Unlimited symptom checks and doctor referrals', billing: 'annual' },
    premium_monthly: { name: 'Premium Monthly', amount: 1500, label: 'N1,500/month', perks: 'Instant doctor assignment and priority queue', billing: 'monthly' },
    premium_annual: { name: 'Premium Annual', amount: 14400, label: 'N1,200/month billed annually', perks: 'Instant doctor assignment and priority queue', billing: 'annual' },
};

exports.PLANS = PLANS;
exports.NIGERIAN_BANKS = NIGERIAN_BANKS;

// ── Auth header ───────────────────────────────────────────────────────────────
const headers = () => {
    if (!FLUTTERWAVE_SECRET) throw new Error('Missing FLUTTERWAVE_SECRET_KEY');
    return { Authorization: `Bearer ${FLUTTERWAVE_SECRET}`, 'Content-Type': 'application/json' };
};

const safeEmail = (email, phone) =>
    (email && email.includes('@') && !email.includes('@abctelemedica'))
        ? email
        : `patient${phone}@abctelemedica.ng`;

// ═══════════════════════════════════════════════════════════════════════════════
// PAYMENT INITIATION — Standard link (card / all methods)
// ═══════════════════════════════════════════════════════════════════════════════

exports.initiateSubscriptionPayment = async ({ email, plan, patientId, phone }) => {
    const planData = PLANS[plan];
    if (!planData) throw new Error(`Invalid plan: ${plan}`);
    if (!process.env.APP_URL) throw new Error('Missing APP_URL');

    const tx_ref = `sub_${patientId}_${Date.now()}`;
    const response = await axios.post(`${BASE_URL}/payments`, {
        tx_ref,
        amount: planData.amount,
        currency: 'NGN',
        redirect_url: `${process.env.APP_URL}/api/flutterwave/webhook/callback`,
        customer: { email: safeEmail(email, phone), phone_number: phone },
        meta: { patientId: String(patientId), phone, plan, type: 'subscription' },
        customizations: { title: `AbcTeleMed — ${planData.name}`, description: planData.perks },
    }, { headers: headers() });

    return { ...response.data.data, tx_ref };
};

exports.initiateConsultationPayment = async ({ email, amount, patientId, doctorId, consultationRef, phone }) => {
    if (!process.env.APP_URL) throw new Error('Missing APP_URL');
    const tx_ref = `consult_${consultationRef}_${Date.now()}`;

    const response = await axios.post(`${BASE_URL}/payments`, {
        tx_ref,
        amount,
        currency: 'NGN',
        redirect_url: `${process.env.APP_URL}/api/flutterwave/webhook/callback`,
        customer: { email: safeEmail(email, phone), phone_number: phone },
        meta: { patientId: String(patientId), doctorId: String(doctorId), consultationRef: String(consultationRef), phone, type: 'consultation' },
        customizations: { title: 'AbcTeleMed — Consultation Payment', description: 'Doctor consultation fee' },
    }, { headers: headers() });

    return { ...response.data.data, tx_ref };
};

// ═══════════════════════════════════════════════════════════════════════════════
// USSD PAYMENT — No redirect, patient dials a code from their phone
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Initiate a USSD charge.
 * Returns { tx_ref, flw_ref, payment_code, ussdString, instruction, bankName }
 * patient dials ussdString from their phone and confirms.
 */
exports.initiateUssdPayment = async ({ email, amount, patientId, doctorId, consultationRef, phone, bankCode, fullname }) => {
    const bankInfo = NIGERIAN_BANKS[bankCode];
    if (!bankInfo) throw new Error(`Unsupported bank code: ${bankCode}`);

    const tx_ref = `ussd_consult_${consultationRef}_${Date.now()}`;

    try {
        const response = await axios.post(
            `${BASE_URL}/charges?type=ussd`,
            {
                tx_ref,
                account_bank: bankCode,
                amount,
                currency: 'NGN',
                email: safeEmail(email, phone),
                phone_number: phone,
                fullname: fullname || 'Patient',
            },
            { headers: headers() }
        );

        const data = response.data.data;
        const payment_code = data?.payment_code || data?.meta?.authorization?.transfer_reference;
        const instruction = data?.meta?.authorization?.instruction || '';

        // Build the USSD string the patient dials
        const ussdString = payment_code ? bankInfo.ussd(payment_code) : null;

        console.log(`💳 USSD initiated — bank: ${bankInfo.name} | tx_ref: ${tx_ref} | code: ${ussdString}`);

        return {
            tx_ref,
            flw_ref: data?.flw_ref,
            payment_code,
            ussdString,
            instruction,
            bankName: bankInfo.name,
            meta: { patientId: String(patientId), doctorId: String(doctorId), consultationRef: String(consultationRef), phone, type: 'consultation' },
        };
    } catch (err) {
        console.error('USSD initiation error:', err.response?.data || err.message);
        throw new Error(err.response?.data?.message || 'Could not initiate USSD payment');
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// BANK TRANSFER — Show virtual account in WhatsApp, patient transfers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a temporary virtual bank account for the patient to transfer to.
 * Returns { accountNumber, bankName, accountName, tx_ref, expiresAt }
 * Flutterwave fires webhook when transfer is received.
 */
exports.initiateBankTransferPayment = async ({ email, amount, patientId, doctorId, consultationRef, phone, fullname }) => {
    const tx_ref = `transfer_consult_${consultationRef}_${Date.now()}`;

    try {
        const response = await axios.post(
            `${BASE_URL}/virtual-account-numbers`,
            {
                email: safeEmail(email, phone),
                is_permanent: false,
                tx_ref,
                amount,
                currency: 'NGN',
                narration: `AbcTeleMed consultation — ${fullname || 'Patient'}`,
            },
            { headers: headers() }
        );

        const data = response.data.data;
        console.log(`🏦 Virtual account created — account: ${data?.account_number} | tx_ref: ${tx_ref}`);

        return {
            tx_ref,
            accountNumber: data?.account_number,
            bankName: data?.bank_name,
            accountName: data?.account_name || 'ABC Telemedica',
            amount,
            expiresAt: data?.expiry_date || null,
            meta: { patientId: String(patientId), doctorId: String(doctorId), consultationRef: String(consultationRef), phone, type: 'consultation' },
        };
    } catch (err) {
        console.error('Bank transfer initiation error:', err.response?.data || err.message);
        throw new Error(err.response?.data?.message || 'Could not create virtual account');
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// VERIFICATION — Robust, tries multiple strategies
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Verify by transaction ID (most reliable — use when you have the ID from webhook).
 */
exports.verifyByTransactionId = async (transactionId) => {
    try {
        const response = await axios.get(
            `${BASE_URL}/transactions/${transactionId}/verify`,
            { headers: headers() }
        );
        return response.data.data;
    } catch (err) {
        console.error('verifyByTransactionId error:', err.response?.data || err.message);
        return null;
    }
};


exports.verifyByTxRef = async (tx_ref) => {
    try {
        console.log(`🔍 Verifying tx_ref: ${tx_ref}`);
        const response = await axios.get(
            `${BASE_URL}/transactions?tx_ref=${encodeURIComponent(tx_ref)}`,
            { headers: headers() }
        );

        const transactions = response.data.data;
        console.log(`🔍 Flutterwave returned ${transactions?.length || 0} transaction(s) for tx_ref: ${tx_ref}`);

        if (!transactions || transactions.length === 0) {
            // No match yet — payment hasn't settled on Flutterwave's side
            console.log(`⏳ No transaction found for tx_ref: ${tx_ref} — may still be settling`);
            return { status: 'pending', tx_ref };
        }

        const tx = transactions[0];
        console.log(`✅ Transaction found — status: ${tx.status} | amount: ${tx.amount} | currency: ${tx.currency}`);

        // Flutterwave list endpoint uses 'success' not 'successful'
        // Normalise both to the same value so callers only check one thing
        return { ...tx, status: tx.status === 'success' ? 'successful' : tx.status };
    } catch (err) {
        console.error('verifyByTxRef error:', err.response?.data || err.message);
        // Return pending so the bot says "not confirmed yet" instead of crashing
        return { status: 'pending', tx_ref };
    }
};

/**
 * Verify a USSD or bank transfer charge by tx_ref using the charges endpoint.
 * More reliable for USSD transactions than the transactions list.
 */
exports.verifyCharge = async (tx_ref) => {
    try {
        const response = await axios.get(
            `${BASE_URL}/transactions?tx_ref=${encodeURIComponent(tx_ref)}&type=ussd`,
            { headers: headers() }
        );
        const transactions = response.data.data;
        if (!transactions || !transactions.length) return { status: 'pending', tx_ref };
        const tx = transactions[0];
        return { ...tx, status: tx.status === 'success' ? 'successful' : tx.status };
    } catch (err) {
        return { status: 'pending', tx_ref };
    }
};

/**
 * Full verification routine — tries list first, then direct verify if ID is available.
 * This is what botFlowService should call.
 */
exports.verifyPaymentFull = async (tx_ref, flw_transaction_id = null) => {
    // Strategy 1: direct verify by transaction ID (if we have it from webhook)
    if (flw_transaction_id) {
        const direct = await exports.verifyByTransactionId(flw_transaction_id);
        if (direct && (direct.status === 'successful' || direct.status === 'success')) {
            return { ...direct, status: 'successful' };
        }
    }

    // Strategy 2: list by tx_ref
    const byRef = await exports.verifyByTxRef(tx_ref);
    return byRef;
};

exports.verifyPayment = async (transactionId) => {
    return exports.verifyByTransactionId(transactionId);
};