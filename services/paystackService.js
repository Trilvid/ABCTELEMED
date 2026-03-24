// const axios = require('axios');

// const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
// const BASE_URL = 'https://api.paystack.co';

// const PLANS = {
//     basic: {
//         name: 'AbcTeleMed Basic',
//         amount: 95000,       // ₦950 in kobo
//         label: 'N750/month',
//         perks: 'Unlimited symptom checks + doctor referrals'
//     },
//     premium: {
//         name: 'AbcTeleMed Premium',
//         amount: 250000,      // N2,500 in kobo
//         label: 'N1,500/month',
//         perks: 'Everything in Basic + instant doctor assignment + priority queue'
//     }
// };

// exports.PLANS = PLANS;

// exports.initiateSubscriptionPayment = async ({ email, plan, patientId, phone }) => {
//     const planData = PLANS[plan];
//     if (!planData) throw new Error(`Invalid plan: ${plan}`);

//     const response = await axios.post(
//         `${BASE_URL}/transaction/initialize`,
//         {
//             // email, // no email is used here so we will stick to numbers
//             phone,
//             amount: planData.amount,
//             metadata: {
//                 patientId: patientId.toString(),
//                 phone,
//                 plan,
//                 type: 'subscription'
//             },
//             callback_url: `${process.env.APP_URL}/api/paystack/callback`
//         },
//         {
//             headers: {
//                 Authorization: `Bearer ${PAYSTACK_SECRET}`,
//                 'Content-Type': 'application/json'
//             }
//         }
//     );

//     return response.data.data; // { authorization_url, access_code, reference }
// };

// exports.verifyPayment = async (reference) => {
//     const response = await axios.get(
//         `${BASE_URL}/transaction/verify/${reference}`,
//         {
//             headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
//         }
//     );
//     return response.data.data; // { status, metadata, amount, ... }
// };


const axios = require('axios');

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const BASE_URL = 'https://api.paystack.co';

const PLANS = {
    basic_monthly: {
        name: 'Basic Monthly',
        amount: 75000,          // N750 in kobo
        label: 'N750/month',
        perks: 'Unlimited symptom checks and doctor referrals',
        billing: 'monthly'
    },
    basic_annual: {
        name: 'Basic Annual',
        amount: 600000,         // N6,000/year (N500/month)
        label: 'N500/month billed annually',
        perks: 'Unlimited symptom checks and doctor referrals',
        billing: 'annual'
    },
    premium_monthly: {
        name: 'Premium Monthly',
        amount: 150000,         // N1,500 in kobo
        label: 'N1,500/month',
        perks: 'Instant doctor assignment and priority queue',
        billing: 'monthly'
    },
    premium_annual: {
        name: 'Premium Annual',
        amount: 1440000,        // N14,400/year (N1,200/month)
        label: 'N1,200/month billed annually',
        perks: 'Instant doctor assignment and priority queue',
        billing: 'annual'
    }
};

exports.PLANS = PLANS;

exports.initiateSubscriptionPayment = async ({ email, plan, patientId, phone }) => {
    const planData = PLANS[plan];
    if (!planData) throw new Error(`Invalid plan: ${plan}`);

    // Ensure email is valid — Paystack rejects malformed emails
    const safeEmailx = email && email.includes('@') && !email.includes('@abctelemed.com')
        ? email
        : `patient${phone}@abctelemed.ng`;

    const safeEmail = 'divinennanna2@gmail.com';

    console.log(`💳 Initiating Paystack for plan: ${plan} | email: ${safeEmail} | amount: ${planData.amount}`);

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
                callback_url: `${process.env.APP_URL}/api/paystack/callback`
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
        // Log full Paystack error so we can see exactly what's wrong
        console.error('❌ Paystack full error:', JSON.stringify(err.response?.data || err.message));
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