import OpenAI from 'openai';
const API_KEY = process.env.OPENROUTER_API_KEY;
const AI_MODEL = process.env.OPENROUTER_MODEL || 'qwen/qwen3-4b:free';

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: API_KEY,
  defaultHeaders: {
    'X-OpenRouter-Title': 'xinxin', // Optional. Site title for rankings on openrouter.ai.
  },
});

async function main() {
  const completion = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [
      {
        role: 'user',
        content: 'What is the meaning of life?',
      },
    ],
  });

  console.log(completion.choices[0].message);
}

main();

// !!! codex, change this into an api POST route so that client message can be sent to the server and get response from openrouter api and send it back to client.