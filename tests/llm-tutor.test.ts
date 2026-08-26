import { afterEach, describe, expect, it, vi } from "vitest"
import OpenAI from "openai"

import {
  buildLlmTutorUserPrompt,
  estimateLlmTutorTokens,
  generateLlmTutorResponse,
  type LlmTutorInput,
} from "@/lib/ai/llm-tutor"

describe("server-side LLM tutor service", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("fails gracefully when AI is disabled and does not call fetch", async () => {
    vi.stubEnv("AI_ENABLED", "false")
    vi.stubEnv("OPENROUTER_API_KEY", "")
    const fetchImpl = vi.fn<typeof fetch>()

    const result = await generateLlmTutorResponse(baseTutorInput(), {
      fetchImpl,
    })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      contextUsed: false,
      error: "ai_disabled",
      fallbackUsed: false,
    })
    expect(result.tutorMessage).toContain("temporarily unavailable")
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
                content: JSON.stringify({
                  schemaVersion: 1,
                  pedagogicalAction: "hint",
                  message:
                    "Use the binomial setup first, then identify the exact count.",
                }),
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
    expect(request.reasoning).toEqual({ enabled: false })
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
          choices: [
            {
              message: {
                content: JSON.stringify({
                  schemaVersion: 1,
                  pedagogicalAction: "hint",
                  message: "Use the sample space first.",
                }),
              },
            },
          ],
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

  it("rejects unsafe provider text after one bounded retry", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key")
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    schemaVersion: 1,
                    pedagogicalAction: "hint",
                    message:
                      "From textbook page 12 and the answer key: the final answer is 2/5.",
                  }),
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

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result.fallbackUsed).toBe(false)
    expect(result.error).toBe("unsafe_provider_output")
    expect(result.tutorMessage).not.toMatch(/textbook page|answer key|2\/5/i)
  })

  it("does not export the raw system prompt", async () => {
    const moduleExports = await import("@/lib/ai/llm-tutor")

    expect("llmTutorSystemPrompt" in moduleExports).toBe(false)
    expect(buildLlmTutorUserPrompt(baseTutorInput())).not.toContain(
      "You are a probability/statistics tutor.",
    )
  })

  it("retries one invalid schema response and accepts the repaired schema", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key")
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(providerResponse("not-json"))
      .mockResolvedValueOnce(
        providerResponse(
          JSON.stringify({
            schemaVersion: 1,
            pedagogicalAction: "hint",
            message: "Identify the exact-count event first.",
          }),
        ),
      )

    const result = await generateLlmTutorResponse(baseTutorInput(), {
      fetchImpl,
      sleepImpl: async () => undefined,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      fallbackUsed: true,
      providerAttempts: 2,
      tutorMessage: "Identify the exact-count event first.",
    })
  })

  it("retries a transient provider limit once without exposing provider details", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key")
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("limited", { status: 429 }))
      .mockResolvedValueOnce(
        providerResponse(
          JSON.stringify({
            schemaVersion: 1,
            pedagogicalAction: "hint",
            message: "Write the binomial probability expression first.",
          }),
        ),
      )

    const result = await generateLlmTutorResponse(baseTutorInput(), {
      fetchImpl,
      sleepImpl: async () => undefined,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result.fallbackUsed).toBe(true)
    expect(result.tutorMessage).not.toMatch(/openrouter|billing|credit|provider/i)
  })

  it("does not retry non-retryable provider rejections", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key")
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("rejected", { status: 400 }))

    const result = await generateLlmTutorResponse(baseTutorInput(), {
      fetchImpl,
      sleepImpl: async () => undefined,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      error: "provider_rejected_request",
      fallbackUsed: false,
      providerAttempts: 1,
    })
    expect(result.tutorMessage).toContain("temporarily unavailable")
  })

  it("retries an SDK-wrapped network failure once", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key")
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("connection failed"))
      .mockResolvedValueOnce(
        providerResponse(
          JSON.stringify({
            schemaVersion: 1,
            pedagogicalAction: "hint",
            message: "Start by identifying the number of independent trials.",
          }),
        ),
      )

    const result = await generateLlmTutorResponse(baseTutorInput(), {
      fetchImpl,
      sleepImpl: async () => undefined,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      fallbackUsed: true,
      providerAttempts: 2,
    })
  })

  it("classifies an OpenAI connection timeout as provider_timeout", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key")
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new OpenAI.APIConnectionTimeoutError({}))

    const result = await generateLlmTutorResponse(baseTutorInput(), {
      fetchImpl,
      sleepImpl: async () => undefined,
    })

    expect(result).toMatchObject({
      error: "provider_timeout",
      fallbackUsed: false,
      providerAttempts: 2,
    })
  })

  it("skips a timeout retry without one full request window remaining", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key")
    let nowMs = 1_000
    vi.spyOn(Date, "now").mockImplementation(() => nowMs)
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      nowMs += 25_001
      throw new OpenAI.APIConnectionTimeoutError({})
    })
    const sleepImpl = vi.fn(async () => undefined)

    const result = await generateLlmTutorResponse(baseTutorInput(), {
      fetchImpl,
      sleepImpl,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sleepImpl).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      error: "deadline_exceeded",
      fallbackUsed: false,
      providerAttempts: 1,
    })
  })

  it("uses only a reviewed private summary and replaces its source title", () => {
    const prompt = buildLlmTutorUserPrompt({
      ...baseTutorInput(),
      retrievedContext: [
        {
          body: "Compare the event definition with the count variable before selecting a formula.",
          id: "reviewed-summary",
          priorityTier: "private_reference",
          sourceType: "private_reference_pattern",
          title: "Private textbook page 48",
          topicId: "binomial-models",
        },
      ],
    })
    const parsed = JSON.parse(prompt) as {
      retrieved_context: Array<{ body: string; title: string }>
    }

    expect(parsed.retrieved_context).toEqual([
      expect.objectContaining({
        body: "Compare the event definition with the count variable before selecting a formula.",
        title: "Reviewed private-reference summary",
      }),
    ])
    expect(prompt).not.toContain("textbook page 48")
  })

  it("builds valid bounded JSON and redacts unnecessary sensitive input", () => {
    const input: LlmTutorInput = {
      ...baseTutorInput(),
      currentQuestion: {
        prompt: "Q".repeat(900),
        title: "T".repeat(300),
      },
      studentMessage: `Email me at student@example.edu ${"x".repeat(700)}`,
    }
    const prompt = buildLlmTutorUserPrompt(input)
    const parsed = JSON.parse(prompt) as {
      prompt_version: number
      retrieved_context: unknown[]
      student_message: string
    }

    expect(prompt.length).toBeLessThanOrEqual(2_400)
    expect(parsed.prompt_version).toBe(1)
    expect(parsed.retrieved_context).toHaveLength(1)
    expect(parsed.student_message).toContain("[email redacted]")
    expect(prompt).not.toContain("student@example.edu")
    expect(estimateLlmTutorTokens(input).estimatedInputTokens).toBeLessThanOrEqual(
      800,
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
    reasoning?: { enabled?: boolean }
  }
}

function providerResponse(content: string) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  )
}
