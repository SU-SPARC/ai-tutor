import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  localResultToRetrievalChunk,
  searchLocalKeywordRetrieval,
  searchLocalRetrieval,
} from "@/lib/ai/retrieval"

describe("local keyword retrieval", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("searches demo question chunks for student-facing retrieval without OpenAI", async () => {
    const repoRoot = createRetrievalFixture()
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    const results = await searchLocalKeywordRetrieval("binomial exact count", {
      maxResults: 3,
      repoRoot,
    })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      sourceLabel: "demo_question_chunks",
      serverOnly: false,
      retrievalMode: "keyword",
      metadata: {
        chunkId: "public-binomial",
        chunkType: "question",
        questionId: "demo-binomial",
        reviewStatus: "approved",
        sourceType: "original_demo",
        trustLevel: "public_original",
        visibility: "public",
      },
    })
    expect(results[0].text).toContain("binomial")
    expect(results[0].score).toBeGreaterThan(0)
  })

  it("keeps private approved and reference chunks server-only", async () => {
    const repoRoot = createRetrievalFixture()
    const studentResults = await searchLocalKeywordRetrieval("bayes flagged", {
      repoRoot,
    })
    const serverResults = await searchLocalKeywordRetrieval("bayes flagged", {
      audience: "server",
      maxResults: 5,
      repoRoot,
    })

    expect(studentResults).toHaveLength(0)
    expect(serverResults.map((result) => result.sourceLabel)).toContain(
      "private_reference_chunks",
    )
    expect(serverResults.every((result) => result.serverOnly)).toBe(true)
    expect(
      serverResults.every(
        (result) => result.metadata.reviewStatus === "approved",
      ),
    ).toBe(true)
  })

  it("includes needs_review generated chunks only for admin/dev mode", async () => {
    const repoRoot = createRetrievalFixture()
    const serverResults = await searchLocalKeywordRetrieval("draft exact count", {
      audience: "server",
      maxResults: 5,
      repoRoot,
    })
    const adminResults = await searchLocalKeywordRetrieval("draft exact count", {
      audience: "admin_dev",
      maxResults: 5,
      repoRoot,
    })

    expect(
      serverResults.some(
        (result) => result.metadata.trustLevel === "generated_unverified",
      ),
    ).toBe(false)
    expect(adminResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceLabel: "private_question_chunks",
          metadata: expect.objectContaining({
            chunkId: "private-draft",
            reviewStatus: "needs_review",
            trustLevel: "generated_unverified",
          }),
        }),
      ]),
    )
  })

  it("applies topic, trust, approval scoring and result limits", async () => {
    const repoRoot = createRetrievalFixture()
    const results = await searchLocalKeywordRetrieval("conditional probability", {
      audience: "server",
      maxResults: 1,
      repoRoot,
      topicId: "conditional-probability",
    })

    expect(results).toHaveLength(1)
    expect(results[0].metadata.chunkId).toBe("private-approved-course")
    expect(results[0].score).toBeGreaterThan(15)

    const retrievalChunk = localResultToRetrievalChunk(results[0])
    expect(retrievalChunk).toMatchObject({
      body: results[0].text,
      questionId: "private-approved-question",
      source: {
        trustLevel: "course_approved",
        visibility: "private",
      },
    })
  })

  it("works when optional private retrieval files are missing", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "retrieval-public-only-"))
    writeJson(
      path.join(repoRoot, "data/processed/demo-question-chunks.json"),
      {
        chunks: [publicChunk()],
      },
    )

    const results = await searchLocalKeywordRetrieval("binomial", {
      audience: "server",
      repoRoot,
    })

    expect(results).toHaveLength(1)
    expect(results[0].sourceLabel).toBe("demo_question_chunks")
  })

  it("supports metadata filters", async () => {
    const repoRoot = createRetrievalFixture()

    const results = await searchLocalRetrieval("conditional probability", {
      audience: "server",
      filters: {
        reviewStatus: "approved",
        questionId: "private-approved-question",
        sourceType: "professor_provided",
        topicId: "conditional-probability",
        trustLevel: "course_approved",
      },
      repoRoot,
    })

    expect(results.map((result) => result.metadata.chunkId)).toEqual([
      "private-approved-course",
    ])
  })

  it("does not expose private matches to student retrieval", async () => {
    const repoRoot = createRetrievalFixture()

    const results = await searchLocalRetrieval("conditional probability", {
      audience: "student",
      maxResults: 5,
      repoRoot,
    })

    expect(results.every((result) => !result.serverOnly)).toBe(true)
    expect(
      results.every((result) => result.sourceLabel === "demo_question_chunks"),
    ).toBe(true)
    expect(results.map((result) => result.metadata.chunkId)).not.toContain(
      "private-approved-course",
    )
  })

  it("limits returned context size and emits debug metadata only in development", async () => {
    const repoRoot = createRetrievalFixture()

    const productionResults = await searchLocalRetrieval("conditional probability", {
      audience: "server",
      maxChunkCharacters: 24,
      maxContextCharacters: 24,
      repoRoot,
    })

    expect(productionResults[0].text.length).toBeLessThanOrEqual(24)
    expect(productionResults[0].debug).toBeUndefined()

    vi.stubEnv("NODE_ENV", "development")
    const developmentResults = await searchLocalRetrieval(
      "conditional probability",
      {
        audience: "server",
        maxResults: 1,
        repoRoot,
      },
    )

    expect(developmentResults[0].debug).toMatchObject({
      mode: "keyword",
      trustBoost: 7,
      approvedBoost: 6,
    })
    vi.unstubAllEnvs()
  })
})

function createRetrievalFixture() {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "retrieval-fixture-"))

  writeJson(path.join(repoRoot, "data/processed/demo-question-chunks.json"), {
    chunks: [
      publicChunk(),
      {
        ...publicChunk(),
        id: "public-draft-ignored",
        reviewStatus: "needs_review",
        trustLevel: "generated_unverified",
        body: "Draft public generated content should not be student-facing.",
      },
    ],
  })
  writeJson(path.join(repoRoot, "data/private/generated/question-chunks.json"), {
    chunks: [
      {
        id: "private-approved-course",
        questionId: "private-approved-question",
        topic: "conditional probability",
        topicId: "conditional-probability",
        difficulty: "intermediate",
        chunkType: "solution_summary",
        body: "Conditional probability uses the event given as the denominator.",
        keywords: ["conditional", "probability", "denominator"],
        sourceType: "professor_provided",
        trustLevel: "course_approved",
        reviewStatus: "approved",
        visibility: "private",
      },
      {
        id: "private-draft",
        questionId: "review-generated-draft",
        topic: "binomial models",
        topicId: "binomial-models",
        difficulty: "intermediate",
        chunkType: "question",
        body: "Draft exact count generated question for binomial practice.",
        keywords: ["draft", "exact", "count"],
        sourceType: "generated_original",
        trustLevel: "generated_unverified",
        reviewStatus: "needs_review",
        visibility: "private",
      },
    ],
  })
  writeJson(path.join(repoRoot, "data/private/generated/reference-chunks.json"), {
    chunks: [
      {
        id: "private-reference-bayes",
        topic: "conditional probability",
        topicId: "conditional-probability",
        chunkType: "concept",
        body: "Bayes retrieval summary for flagged cases.",
        keywords: ["bayes", "flagged"],
        sourceType: "private_reference_pattern",
        trustLevel: "private_reference",
        reviewStatus: "approved",
        visibility: "private",
      },
    ],
  })
  return repoRoot
}

function publicChunk() {
  return {
    id: "public-binomial",
    questionId: "demo-binomial",
    topic: "binomial models",
    topicId: "binomial-models",
    difficulty: "foundational",
    chunkType: "question",
    body: "A binomial exact count question asks for exactly k successes.",
    keywords: ["binomial", "exact", "count"],
    sourceType: "original_demo",
    trustLevel: "public_original",
    reviewStatus: "approved",
    visibility: "public",
  }
}

function writeJson(filePath: string, payload: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`)
}
