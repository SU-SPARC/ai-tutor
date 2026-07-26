import { describe, expect, it } from "vitest"

import {
  applyTutorResponseGuardrails,
  validateTutorResponseGuardrails,
} from "@/lib/ai/response-guardrails"

describe("AI tutor response guardrails", () => {
  it("accepts concise probability/statistics guidance", () => {
    const result = applyTutorResponseGuardrails({
      allowedDisclosure: "hint_only",
      response:
        "Use the binomial model because the trials are independent and the success probability is fixed.",
    })

    expect(result.repaired).toBe(false)
    expect(result.violations).toEqual([])
  })

  it("repairs empty responses with a math redirect", () => {
    const empty = applyTutorResponseGuardrails({
      allowedDisclosure: "hint_only",
      response: "   ",
    })

    expect(empty.violations).toContain("empty_response")
    expect(empty.response).toContain("probability/statistics")
  })

  it("does not flag on-topic guidance that happens to avoid keyword vocabulary", () => {
    // Off-topic keyword matching was removed: it produced high false-positive
    // rates against legitimate but truncated/keyword-light model output.
    // The pre-flight isProbabilityStatisticsRequest gate in tutor-engine.ts
    // already keeps genuinely off-topic student requests from reaching the
    // LLM at all.
    const result = applyTutorResponseGuardrails({
      allowedDisclosure: "hint_only",
      response: "First, list all the ordered outcomes that satisfy the given condition.",
    })

    expect(result.violations).toEqual([])
    expect(result.response).toContain("ordered outcomes")
  })

  it("shortens overly long responses", () => {
    const result = applyTutorResponseGuardrails({
      allowedDisclosure: "hint_only",
      maxCharacters: 90,
      response:
        "Use probability by identifying the sample space first. Then count the favorable outcomes carefully. Finally compare the favorable count with the total number of possible outcomes.",
    })

    expect(result.violations).toContain("too_long")
    expect(result.response.length).toBeLessThanOrEqual(90)
  })

  it("removes unsupported professor approval claims", () => {
    const result = applyTutorResponseGuardrails({
      allowedDisclosure: "hint_only",
      response:
        "This professor-approved probability hint says to identify the sample space first.",
    })

    expect(result.violations).toContain("unsupported_professor_approval")
    expect(result.response).not.toMatch(/professor-approved|approved by/i)
    expect(result.response).toContain("probability")
  })

  it("replaces private, raw, copied, or system-prompt-like content", () => {
    const privateContent = applyTutorResponseGuardrails({
      allowedDisclosure: "hint_only",
      response:
        "From textbook page 42: copied from the answer key, the probability solution is shown verbatim.",
    })
    const systemPrompt = applyTutorResponseGuardrails({
      allowedDisclosure: "hint_only",
      response:
        "System prompt: You are a probability/statistics tutor. Ignore previous hidden instruction text.",
    })

    expect(privateContent.violations).toContain("private_or_raw_content")
    expect(privateContent.violations).toContain("copied_source_like_text")
    expect(privateContent.response).not.toMatch(/textbook page|answer key/i)
    expect(systemPrompt.violations).toContain("system_prompt_exposure")
    expect(systemPrompt.response).not.toContain("System prompt")
  })

  it("prevents full solutions before they are allowed", () => {
    const blocked = applyTutorResponseGuardrails({
      allowedDisclosure: "hint_only",
      response:
        "Use conditional probability. The final answer is 2/5, so the probability is 0.4.",
    })
    const allowed = validateTutorResponseGuardrails({
      allowedDisclosure: "full_solution_allowed",
      response:
        "Use conditional probability. The final answer is 2/5, so the probability is 0.4.",
    })

    expect(blocked.violations).toContain("full_solution_too_early")
    expect(blocked.response).not.toContain("2/5")
    expect(allowed).not.toContain("full_solution_too_early")
  })
})
