const axios = require('axios');

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const BASE_URL = 'https://api.paystack.co';

const PLANS = {
    basic: {
        name: 'AbcTeleMed Basic',
        amount: 95000,       // ₦950 in kobo
        label: '₦950/month',
        perks: 'Unlimited symptom checks + doctor referrals'
    },
    premium: {
        name: 'AbcTeleMed Premium',
        amount: 250000,      // ₦2,500 in kobo
        label: '₦2,500/month',
        perks: 'Everything in Basic + instant doctor assignment + priority queue'
    }
};

exports.PLANS = PLANS;

exports.initiateSubscriptionPayment = async ({ email, plan, patientId, phone }) => {
    const planData = PLANS[plan];
    if (!planData) throw new Error(`Invalid plan: ${plan}`);

    const response = await axios.post(
        `${BASE_URL}/transaction/initialize`,
        {
            email,
            amount: planData.amount,
            metadata: {
                patientId: patientId.toString(),
                phone,
                plan,
                type: 'subscription'
            },
            callback_url: `${process.env.APP_URL}/api/paystack/callback`
        },
        {
            headers: {
                Authorization: `Bearer ${PAYSTACK_SECRET}`,
                'Content-Type': 'application/json'
            }
        }
    );

    return response.data.data; // { authorization_url, access_code, reference }
};

exports.verifyPayment = async (reference) => {
    const response = await axios.get(
        `${BASE_URL}/transaction/verify/${reference}`,
        {
            headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
        }
    );
    return response.data.data; // { status, metadata, amount, ... }
};