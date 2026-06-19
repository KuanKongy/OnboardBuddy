import { OpenRouter } from '@openrouter/sdk';

export const SUMMARY_MODEL = process.env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini';

const client = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY ?? '',
});

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export async function chatCompletion(messages: ChatMessage[], model = SUMMARY_MODEL): Promise<string> {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is not set');

  const response = await client.chat.send({ chatRequest: { model, messages } });

  const content = response.choices[0]?.message?.content ?? '';
  if (!content) throw new Error('OpenRouter returned empty response');
  return content;
}
