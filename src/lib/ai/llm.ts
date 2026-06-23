import "server-only"

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
  const openAiKey = process.env.OPENAI_API_KEY
  const openRouterKey = process.env.OPENROUTER_API_KEY
  const apiKey = openAiKey ?? openRouterKey

  if (!apiKey) {
    return {
      ok: false,
      reason:
        "LLM fallback is not configured. Add OPENAI_API_KEY or OPENROUTER_API_KEY on the server to enable it.",
    }
  }

  const baseUrl =
    process.env.OPENAI_BASE_URL ??
    (openRouterKey ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1")
  const model =
    process.env.OPENAI_MODEL ?? process.env.OPENROUTER_MODEL ?? "gpt-4.1-mini"

  const result = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 250,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are a concise probability and statistics tutor. Give one short hint or step. Do not claim access to course materials unless provided.",
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
