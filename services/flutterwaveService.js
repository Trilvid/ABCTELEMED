const axios = require('axios');

const FLUTTERWAVE_SECRET = process.env.FLUTTERWAVE_SECRET_KEY;
const BASE_URL = 'https://api.flutterwave.com/v3';

const PLANS = {
    basic_monthly: {
        name: 'Basic Monthly',
        amount: 750,
        label: 'N750/month',
        perks: 'Unlimited symptom checks and doctor referrals',
        billing: 'monthly'
    },
    basic_annual: {
        name: 'Basic Annual',
        amount: 6000,
        label: 'N500/month billed annually',
        perks: 'Unlimited symptom checks and doctor referrals',
        billing: 'annual'
    },
    premium_monthly: {
        name: 'Premium Monthly',
        amount: 1500,
        label: 'N1,500/month',
        perks: 'Instant doctor assignment and priority queue',
        billing: 'monthly'
    },
    premium_annual: {
        name: 'Premium Annual',
        amount: 14400,
        label: 'N1,200/month billed annually',
        perks: 'Instant doctor assignment and priority queue',
        billing: 'annual'
    }
};

exports.PLANS = PLANS;

exports.initiateSubscriptionPayment = async ({ email, plan, patientId, phone }) => {
    const planData = PLANS[plan];
    if (!planData) throw new Error(`Invalid plan: ${plan}`);
    if (!FLUTTERWAVE_SECRET) throw new Error('Missing FLUTTERWAVE_SECRET_KEY');
    if (!process.env.APP_URL) throw new Error('Missing APP_URL');

    const safeEmail = email && email.includes('@') && !email.includes('@abctelemedica.com')
        ? email
        : `patient${phone}@abctelemedica.ng`;

    const tx_ref = `sub_${patientId}_${Date.now()}`;
    console.log(`Initiating Flutterwave for plan: ${plan} | email: ${safeEmail} | amount: ${planData.amount}`);

    try {
        const response = await axios.post(
            `${BASE_URL}/payments`,
            {
                tx_ref,
                amount: planData.amount,
                currency: 'NGN',
                redirect_url: `${process.env.APP_URL}/api/flutterwave/webhook/callback`,
                customer: {
                    email: safeEmail,
                    phone_number: phone
                },
                meta: {
                    patientId: patientId.toString(),
                    phone,
                    plan,
                    type: 'subscription'
                },
                customizations: {
                    title: `AbcTeleMed — ${planData.name}`,
                    description: planData.perks
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${FLUTTERWAVE_SECRET}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        return { ...response.data.data, tx_ref };
    } catch (err) {
        console.error('Flutterwave full error:', JSON.stringify(err.response?.data || err.message));
        throw err;
    }
};

exports.verifyPayment = async (transactionId) => {
    if (!FLUTTERWAVE_SECRET) throw new Error('Missing FLUTTERWAVE_SECRET_KEY');
    const response = await axios.get(
        `${BASE_URL}/transactions/${transactionId}/verify`,
        {
            headers: { Authorization: `Bearer ${FLUTTERWAVE_SECRET}` }
        }
    );

    return response.data.data;
};

exports.initiateConsultationPayment = async ({ email, amount, patientId, doctorId, consultationRef, phone }) => {
    if (!FLUTTERWAVE_SECRET) throw new Error('Missing FLUTTERWAVE_SECRET_KEY');
    if (!process.env.APP_URL) throw new Error('Missing APP_URL');

    const safeEmail = email && email.includes('@') && !email.includes('@abctelemedica.com')
        ? email
        : `patient${phone}@abctelemedica.ng`;

    const tx_ref = `consult_${consultationRef}_${Date.now()}`;
    console.log(`Initiating consultation payment — amount: ${amount} | email: ${safeEmail}`);

    try {
        const response = await axios.post(
            `${BASE_URL}/payments`,
            {
                tx_ref,
                amount, // Flutterwave accepts Naira directly
                currency: 'NGN',
                redirect_url: `${process.env.APP_URL}/api/flutterwave/webhook/callback`,
                customer: {
                    email: safeEmail,
                    phone_number: phone
                },
                meta: {
                    patientId: patientId.toString(),
                    doctorId: doctorId.toString(),
                    consultationRef: consultationRef.toString(),
                    phone,
                    type: 'consultation'
                },
                customizations: {
                    title: 'AbcTeleMed — Consultation Payment',
                    description: 'Doctor consultation fee'
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${FLUTTERWAVE_SECRET}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        return { ...response.data.data, tx_ref };
    } catch (err) {
        console.error('Flutterwave consultation init error:', JSON.stringify(err.response?.data || err.message));
        throw err;
    }
};
