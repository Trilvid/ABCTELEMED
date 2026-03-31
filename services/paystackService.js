const axios = require('axios');

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const BASE_URL = 'https://api.paystack.co';

const PLANS = {
    basic_monthly: {
        name: 'Basic Monthly',
        amount: 75000,
        label: 'N750/month',
        perks: 'Unlimited symptom checks and doctor referrals',
        billing: 'monthly'
    },
    basic_annual: {
        name: 'Basic Annual',
        amount: 600000,
        label: 'N500/month billed annually',
        perks: 'Unlimited symptom checks and doctor referrals',
        billing: 'annual'
    },
    premium_monthly: {
        name: 'Premium Monthly',
        amount: 150000,
        label: 'N1,500/month',
        perks: 'Instant doctor assignment and priority queue',
        billing: 'monthly'
    },
    premium_annual: {
        name: 'Premium Annual',
        amount: 1440000,
        label: 'N1,200/month billed annually',
        perks: 'Instant doctor assignment and priority queue',
        billing: 'annual'
    }
};

exports.PLANS = PLANS;

exports.initiateSubscriptionPayment = async ({ email, plan, patientId, phone }) => {
    const planData = PLANS[plan];
    if (!planData) throw new Error(`Invalid plan: ${plan}`);
    if (!PAYSTACK_SECRET) throw new Error('Missing PAYSTACK_SECRET_KEY');

    const safeEmail = email && email.includes('@') && !email.includes('@abctelemed.com')
        ? email
        : `patient${phone}@abctelemed.ng`;

    console.log(`Initiating Paystack for plan: ${plan} | email: ${safeEmail} | amount: ${planData.amount}`);

    try {
        const response = await axios.post(
            `${BASE_URL}/transaction/initialize`,
            {
                email: safeEmail,
                amount: planData.amount,
                metadata: {
                    patientId: patientId.toString(),
                    phone,
                    plan,
                    type: 'subscription'
                },
                callback_url: `${process.env.APP_URL}/api/paystack/webhook/callback`
            },
            {
                headers: {
                    Authorization: `Bearer ${PAYSTACK_SECRET}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        return response.data.data;
    } catch (err) {
        console.error('Paystack full error:', JSON.stringify(err.response?.data || err.message));
        throw err;
    }
};

exports.verifyPayment = async (reference) => {
    const response = await axios.get(
        `${BASE_URL}/transaction/verify/${reference}`,
        {
            headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
        }
    );

    return response.data.data;
};
