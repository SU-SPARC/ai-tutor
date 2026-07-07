import { readFileSync } from "node:fs"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createOpenAIEmbeddingProvider,
  retrievalContentHash,
} from "@/lib/ai/embeddings"
import { createDatabaseContentRepository } from "@/lib/data/database-repository"
import {
  buildLlmGroundingContext,
  rankRetrievalChunks,
} from "@/lib/tutor/retrieval"
import type {
  RetrievalChunk,
  RetrievalPriorityTier,
  ReviewStatus,
  SourceType,
  TrustLevel,
  Visibility,
} from "@/lib/types"

describe("retrieval ranking and safety", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("ranks trusted course material ahead of generated, private summary, demo, and admin draft matches", () => {
    const chunks = [
      retrievalChunk({
        id: "demo",
        priorityTier: "safe_demo",
        sourceType: "original_demo",
        trustLevel: "public_original",
      }),
      retrievalChunk({
        id: "private-summary",
        body: "Raw private reference body that should not be returned.",
        llmSafeSummary: "Use the binomial model with independent trials.",
        priorityTier: "private_reference",
        sourceType: "private_reference_pattern",
        trustLevel: "private_reference",
        visibility: "private",
      }),
      retrievalChunk({
        id: "approved-generated",
        priorityTier: "approved_generated",
        sourceType: "generated_original",
        trustLevel: "professor_approved",
      }),
      retrievalChunk({
        id: "professor-course",
        priorityTier: "approved_professor_course",
        sourceType: "professor_provided",
        trustLevel: "course_approved",
      }),
      retrievalChunk({
        id: "admin-draft",
        priorityTier: "admin_dev_draft",
        reviewStatus: "needs_review",
        sourceType: "generated_original",
        trustLevel: "generated_unverified",
      }),
    ]

    const adminMatches = rankRetrievalChunks("binomial model", chunks, {
      audience: "admin_dev",
      maxResults: 5,
    })

    expect(adminMatches.map((match) => match.chunk.id)).toEqual([
      "professor-course",
      "approved-generated",
      "private-summary",
      "demo",
      "admin-draft",
    ])

    const studentMatches = rankRetrievalChunks("binomial model", chunks, {
      audience: "student",
      maxResults: 5,
    })

    expect(studentMatches.map((match) => match.chunk.id)).not.toContain(
      "admin-draft",
    )
  })

  it("returns private references to students only through safe summaries", () => {
    const matches = rankRetrievalChunks(
      "bayes rates",
      [
        retrievalChunk({
          id: "private-bayes",
          body: "Raw private textbook page text that should never leave.",
          conceptTags: ["bayes rates"],
          llmSafeSummary: "Use Bayes' rule to combine base rates and flag rates.",
          priorityTier: "private_reference",
          sourceType: "private_reference_pattern",
          trustLevel: "private_reference",
          visibility: "private",
        }),
      ],
      { audience: "student" },
    )

    expect(matches).toHaveLength(1)
    expect(matches[0].chunk.body).toBe(
      "Use Bayes' rule to combine base rates and flag rates.",
    )
    expect(matches[0].chunk.body).not.toContain("textbook page")
  })

  it("builds compact LLM grounding context and drops forbidden private-source signals", () => {
    const matches = [
      {
        chunk: retrievalChunk({
          id: "forbidden",
          body: "This mentions a source page and must not be sent.",
        }),
        priorityTier: "safe_demo" as RetrievalPriorityTier,
        score: 20,
      },
      ...Array.from({ length: 4 }, (_, index) => ({
        chunk: retrievalChunk({
          id: `safe-${index}`,
          body:
            "Use the binomial model when trials are independent and the success probability is fixed.",
        }),
        priorityTier: "safe_demo" as RetrievalPriorityTier,
        score: 10 - index,
      })),
    ]

    const context = buildLlmGroundingContext(matches, {
      maxCharsPerChunk: 40,
      maxItems: 3,
      maxTotalChars: 90,
    })

    expect(context.map((item) => item.id)).not.toContain("forbidden")
    expect(context).toHaveLength(3)
    expect(context.every((item) => item.body.length <= 40)).toBe(true)
    expect(context.reduce((total, item) => total + item.body.length, 0)).toBeLessThanOrEqual(
      90,
    )
  })

  it("skips embedding search when embedding env vars are missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "")
    vi.stubEnv("OPENAI_EMBEDDING_MODEL", "")

    const provider = createOpenAIEmbeddingProvider()
    const result = await provider.embed("binomial model")

    expect(provider.isConfigured()).toBe(false)
    expect(result).toMatchObject({
      ok: false,
      skipped: true,
    })
    expect(retrievalContentHash(" binomial model ")).toBe(
      retrievalContentHash("binomial model"),
    )
  })
})

describe("database retrieval repository", () => {
  it("reads only from the student-safe retrieval view", async () => {
    const queries: string[] = []
    const repository = createDatabaseContentRepository(
      "postgres://user:pass@example.test/db",
      async (sql) => {
        queries.push(sql)
        return [
          {
            id: "db-binomial",
            topic_id: "binomial-models",
            question_id: null,
            chunk_type: "formula",
            title: "Binomial formula",
            body: "Use C(n,k)p^k(1-p)^(n-k).",
            llm_safe_summary: null,
            keywords_json: ["binomial"],
            formula_refs_json: ["P(X = k)"],
            concept_tags_json: ["exact count"],
            difficulty: null,
            source_type: "professor_provided",
            trust_level: "course_approved",
            review_status: "approved",
            visibility: "public",
            priority_tier: "approved_professor_course",
            embedding_model: "text-embedding-3-small",
            content_hash: "hash-1",
          },
        ]
      },
    )

    const chunks = await repository.getRetrievalChunks()

    expect(queries[0]).toContain("app_student_retrieval_chunks")
    expect(chunks[0]).toMatchObject({
      id: "db-binomial",
      chunkType: "formula",
      formulaRefs: ["P(X = k)"],
      conceptTags: ["exact count"],
      priorityTier: "approved_professor_course",
      embeddingModel: "text-embedding-3-small",
      contentHash: "hash-1",
    })
  })

  it("adds retrieval storage without requiring pgvector", () => {
    const migration = readFileSync(
      path.join(process.cwd(), "db/migrations/003_retrieval_chunks.sql"),
      "utf8",
    )

    expect(migration).toContain("create table if not exists retrieval_chunks")
    expect(migration).toContain("app_student_retrieval_chunks")
    expect(migration).toContain("app_admin_retrieval_chunks")
    expect(migration).toContain("llm_safe_summary")
    expect(migration).toContain("priority_tier")
    expect(migration).not.toMatch(/vector\s*\(/i)
  })
})

function retrievalChunk(
  overrides: Partial<{
    body: string
    conceptTags: string[]
    id: string
    llmSafeSummary: string
    priorityTier: RetrievalPriorityTier
    reviewStatus: ReviewStatus
    sourceType: SourceType
    trustLevel: TrustLevel
    visibility: Visibility
  }> = {},
): RetrievalChunk {
  return {
    id: overrides.id ?? "chunk",
    topicId: "binomial-models",
    chunkType: "concept",
    title: "Retrieval chunk",
    body: overrides.body ?? "Use the binomial model with independent trials.",
    keywords: ["binomial", "model"],
    formulaRefs: [],
    conceptTags: overrides.conceptTags ?? ["binomial model"],
    priorityTier: overrides.priorityTier ?? "safe_demo",
    llmSafeSummary: overrides.llmSafeSummary,
    source: {
      sourceType: overrides.sourceType ?? "original_demo",
      trustLevel: overrides.trustLevel ?? "public_original",
      visibility: overrides.visibility ?? "public",
    },
    review: {
      status: overrides.reviewStatus ?? "approved",
    },
  }
}
