import { describe, expect, it } from "vitest"

import {
  responseUsageStatusText,
  shouldShowRetrievedContext,
} from "@/components/tutor/practice-workspace"

describe("practice usage indicators", () => {
  it("maps tutor provenance to student-safe status text", () => {
    expect(
      responseUsageStatusText({
        responseLabel: "approved_course_content",
        source: "rule",
      }),
    ).toBe("From your professor's questions")
    expect(
      responseUsageStatusText({
        responseLabel: "generated_approved_content",
        source: "retrieval",
      }),
    ).toBe("From your professor's questions")
    expect(
      responseUsageStatusText({
        responseLabel: "private_reference_grounded_explanation",
        source: "retrieval",
      }),
    ).toBe("From your course notes")
    expect(
      responseUsageStatusText({
        responseLabel: "general_ai_help",
        source: "llm",
      }),
    ).toBe("Answered with AI help")
    expect(
      responseUsageStatusText({
        responseLabel: "private_reference_grounded_explanation",
        source: "cache",
      }),
    ).toBe("Answered with AI help")
  })

  it("does not expose source excerpts in status text", () => {
    const status = responseUsageStatusText({
      responseLabel: "private_reference_grounded_explanation",
      source: "retrieval",
    })

    expect(status).toBe("From your course notes")
    expect(status).not.toMatch(/page|chunk|locator|excerpt|textbook/i)
    expect(status).not.toMatch(/fallback|retrieval|generated|private/i)
    expect(
      shouldShowRetrievedContext({
        responseLabel: "private_reference_grounded_explanation",
        retrievedContext: [
          {
            body: "Synthetic private body that must not render.",
            chunkType: "concept",
            conceptTags: [],
            formulaRefs: [],
            id: "private-context",
            keywords: [],
            priorityTier: "private_reference",
            review: {
              reviewedAt: "2026-07-10T00:00:00.000Z",
              status: "approved",
            },
            source: {
              originalityNote: "Synthetic test fixture.",
              sourceType: "private_reference_pattern",
              trustLevel: "private_reference",
              visibility: "private",
            },
            title: "Private source title",
            topicId: "conditional-probability",
          },
        ],
      }),
    ).toBe(false)
  })
})
