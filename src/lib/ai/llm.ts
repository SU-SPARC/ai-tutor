import "server-only"

import { getServerEnv } from "@/lib/env/server"

type FallbackResult =
  | {
      ok: true
      text: string
    }
  | {
      ok: false
      reason: string
    }

export async function generateLlmFallback(prompt: string): Promise<FallbackResult> {
  const env = getServerEnv()

  if (!env.OPENAI_API_KEY) {
    return {
      ok: false,
      reason:
        "LLM fallback is not configured. Add OPENAI_API_KEY on the server to enable it.",
    }
  }

  const result = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      max_tokens: 250,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are a concise probability and statistics tutor. Give one short conceptual hint or next step only. Do not provide a final numeric answer. Do not claim access to course materials unless provided.",
        },
        {
          role: "user",
          content: prompt.slice(0, 1200),
        },
      ],
    }),
  })

  if (!result.ok) {
    return {
      ok: false,
      reason: "The configured LLM provider rejected the fallback request.",
    }
  }

  const payload = (await result.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const text = payload.choices?.[0]?.message?.content?.trim()

  if (!text) {
    return {
      ok: false,
      reason: "The configured LLM provider returned an empty response.",
    }
  }

  return {
    ok: true,
    text,
  }
}
