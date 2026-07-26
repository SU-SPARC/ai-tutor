import { afterEach, describe, expect, it, vi } from "vitest"

import {
  buildLlmTutorUserPrompt,
  generateLlmTutorResponse,
  type LlmTutorInput,
} from "@/lib/ai/llm-tutor"

describe("server-side LLM tutor service", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("fails gracefully without OPENROUTER_API_KEY and does not call fetch", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "")
    const fetchImpl = vi.fn<typeof fetch>()

    const result = await generateLlmTutorResponse(baseTutorInput(), {
      fetchImpl,
    })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      contextUsed: false,
      error: "missing_api_key",
      fallbackUsed: false,
    })
    expect(result.tutorMessage).toContain("LLM fallback is not configured")
    expect(result.estimatedTokens?.estimatedTotalTokens).toBeGreaterThan(0)
  })

  it("uses env model/key, sends structured context, and returns token metadata", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key")
    vi.stubEnv("AI_MODEL", "test-model")
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "Use the binomial setup first, then identify the exact count.",
              },
            },
          ],
          usage: {
            completion_tokens: 15,
            prompt_tokens: 80,
            total_tokens: 95,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )

    const result = await generateLlmTutorResponse(baseTutorInput(), {
      fetchImpl,
    })
    const request = llmTutorRequestPayload(fetchImpl)
    const userPrompt = request.messages[1]?.content ?? ""

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(request.model).toBe("test-model")
    expect(request.max_tokens).toBe(400)
    expect(request.messages[0]?.role).toBe("system")
    expect(request.messages[1]?.role).toBe("user")
    expect(userPrompt).toContain("student_message")
    expect(userPrompt).toContain("current_question")
    expect(userPrompt).toContain("session_state")
    expect(userPrompt).toContain("retrieved_context")
    expect(userPrompt).toContain("Use the binomial model")
    expect(userPrompt).not.toContain("Raw private textbook page")
    expect(result).toMatchObject({
      contextUsed: true,
      fallbackUsed: true,
      tutorMessage:
        "Use the binomial setup first, then identify the exact count.",
    })
    expect(result.estimatedTokens).toMatchObject({
      providerCompletionTokens: 15,
      providerPromptTokens: 80,
      providerTotalTokens: 95,
    })
  })

  it("uses the server-configured output token cap", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key")
    vi.stubEnv("MAX_LLM_OUTPUT_TOKENS", "73")
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Use the sample space first." } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )

    await generateLlmTutorResponse(baseTutorInput(), { fetchImpl })

    expect(llmTutorRequestPayload(fetchImpl).max_tokens).toBe(73)
  })

  it("handles provider errors without exposing prompts", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key")
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("bad request", { status: 400 }))

    const result = await generateLlmTutorResponse(baseTutorInput(), {
      fetchImpl,
    })

    expect(result).toMatchObject({
      contextUsed: false,
      error: "provider_rejected_request",
      fallbackUsed: false,
    })
    expect(result.tutorMessage).not.toContain(
      "You are a probability/statistics",
    )
  })

  it("repairs unsafe provider text before returning tutor output", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key")
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    "From textbook page 12 and the answer key: the final answer is 2/5.",
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    )

    const result = await generateLlmTutorResponse(baseTutorInput(), {
      fetchImpl,
    })

    expect(result.fallbackUsed).toBe(true)
    expect(result.tutorMessage).toContain("probability/statistics")
    expect(result.tutorMessage).not.toMatch(/textbook page|answer key|2\/5/i)
  })

  it("does not export the raw system prompt", async () => {
    const moduleExports = await import("@/lib/ai/llm-tutor")

    expect("llmTutorSystemPrompt" in moduleExports).toBe(false)
    expect(buildLlmTutorUserPrompt(baseTutorInput())).not.toContain(
      "You are a probability/statistics tutor.",
    )
  })
})

function baseTutorInput(): LlmTutorInput {
  return {
    allowedDisclosure: "hint_only",
    answerCheck: {
      confidence: 0.1,
      feedback: "The answer does not match the accepted form.",
    },
    currentQuestion: {
      title: "Exact count probability",
      prompt:
        "A student guesses on independent questions. What is the chance of exactly two correct answers?",
    },
    mode: "check",
    provenanceNote:
      "Use only the retrieved approved/demo context below. Do not claim professor approval.",
    retrievedContext: [
      {
        body: "Use the binomial model when trials are independent and the target is an exact count.",
        id: "safe-binomial",
        priorityTier: "safe_demo",
        sourceType: "original_demo",
        title: "Binomial setup",
        topicId: "binomial-models",
      },
      {
        body: "Raw private textbook page text that should not be sent.",
        id: "raw-private",
        priorityTier: "private_reference",
        sourceType: "private_reference_pattern",
        title: "Private source page",
        topicId: "binomial-models",
      },
    ],
    sessionState: {
      hintsRevealed: 1,
      solved: false,
      stepsRevealed: 0,
    },
    studentMessage: "I know this is binomial, but I am stuck.",
    task: "low_confidence_answer_help",
    topicId: "binomial-models",
  }
}

function llmTutorRequestPayload(
  fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>,
) {
  const init = fetchImpl.mock.calls[0]?.[1]
  const body = typeof init?.body === "string" ? init.body : ""

  if (!body) {
    throw new Error("Expected LLM tutor request body.")
  }

  return JSON.parse(body) as {
    max_tokens?: number
    messages: Array<{ content?: string; role?: string }>
    model?: string
  }
}
