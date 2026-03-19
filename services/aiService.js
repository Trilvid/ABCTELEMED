// services/aiService.js
const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

exports.analyseSymptoms = async (symptoms) => {
    const msg = await client.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 500,
        messages: [{
            role: 'user',
            content: `A patient reports these symptoms: ${symptoms.join(', ')}.
      
      Respond ONLY in JSON with:
      {
        "summary": "brief plain-language explanation",
        "recommendation": "self-care | see a GP | go to ER",
        "specialty": "cardiology | general | etc",
        "needsDoctor": true/false,
        "urgency": "low | medium | high"
      }`
        }]
    });

    return JSON.parse(msg.content[0].text);
};