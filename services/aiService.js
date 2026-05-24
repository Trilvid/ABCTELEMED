
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

exports.analyseSymptoms = async (symptoms) => {
    try {
        const response = await client.messages.create({
            model: 'claude-opus-4-6',
            max_tokens: 512,
            messages: [
                {
                    role: 'user',
                    content: `You are a medical triage assistant. A patient reports the following symptoms: "${symptoms.join(', ')}".

Analyse the symptoms and respond ONLY with a valid JSON object — no extra text, no markdown, no explanation. Use exactly this structure:
{
  "summary": "brief plain-language explanation of what the symptoms may indicate",
  "recommendation": "one of: self-care | see a GP | go to ER",
  "specialty": "one of: general_practice | cardiology | dermatology | pediatrics | gynecology | orthopedics | neurology | psychiatry | other",
  "needsDoctor": true or false,
  "urgency": "one of: low | medium | high"
}`
                }
            ]
        });

        const raw = response.content[0].text.trim();
        const parsed = JSON.parse(raw);

        // Validate required fields exist before returning
        const result = {
            summary: parsed.summary || 'Unable to analyse symptoms at this time.',
            recommendation: parsed.recommendation || 'see a GP',
            specialty: parsed.specialty || 'general_practice',
            needsDoctor: parsed.needsDoctor ?? true,
            urgency: parsed.urgency || 'medium'
        };

        return result;

    } catch (err) {
        console.error('❌ aiService.analyseSymptoms error:', err.message);

        // Safe fallback — bot continues even if AI fails
        return {
            summary: 'We were unable to fully analyse your symptoms right now.',
            recommendation: 'see a GP',
            specialty: 'general_practice',
            needsDoctor: true,
            urgency: 'medium'
        };
    }
};