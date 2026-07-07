import "server-only"

import {
  reviewStatusForAction,
  type ContentRepository,
  type QuestionCounts,
} from "@/lib/data/repository"
import type {
  Difficulty,
  Misconception,
  RetrievalChunk,
  RetrievalChunkType,
  RetrievalPriorityTier,
  ReviewCandidate,
  ReviewMetadata,
  SourceMetadata,
  TutorQuestion,
} from "@/lib/types"

type QueryValue = boolean | Date | null | number | string | string[]
type QueryExecutor = (
  sql: string,
  params?: QueryValue[],
) => Promise<Record<string, unknown>[]>

type QuestionRow = {
  accepted_answers_json: unknown
  answer_explanation: string
  difficulty: Difficulty
  hints_json: unknown
  id: string
  misconceptions_json: unknown
  numeric_value: number | null
  originality_note: string | null
  pattern_id: string | null
  pattern_source?: string | null
  prompt: string
  reviewed_at: Date | string | null
  reviewed_by: string | null
  review_status: ReviewMetadata["status"]
  solution_steps_json: unknown
  source_type: SourceMetadata["sourceType"]
  title: string
  tolerance: number | null
  topic_id: string
  trust_level: SourceMetadata["trustLevel"]
  visibility: SourceMetadata["visibility"]
}

type RetrievalChunkRow = {
  body: string
  chunk_type: RetrievalChunkType
  concept_tags_json: unknown
  content_hash: string | null
  difficulty: Difficulty | null
  embedding_model: string | null
  formula_refs_json: unknown
  id: string
  keywords_json: unknown
  llm_safe_summary: string | null
  priority_tier: RetrievalPriorityTier
  question_id: string | null
  review_status: ReviewMetadata["status"]
  source_type: SourceMetadata["sourceType"]
  title: string
  topic_id: string
  trust_level: SourceMetadata["trustLevel"]
  visibility: SourceMetadata["visibility"]
}

const APPROVED_PUBLIC_WHERE =
  "visibility = 'public' and review_status = 'approved' and trust_level in ('public_original', 'professor_approved', 'course_approved')"

export function createDatabaseContentRepository(
  databaseUrl: string,
  query: QueryExecutor = createUnavailableQueryExecutor(databaseUrl),
): ContentRepository {
  return {
    async getApprovedQuestionById(questionId) {
      return this.getQuestionById(questionId)
    },

    async getQuestionById(questionId) {
      const rows = await query(
        `
          select *
          from app_public_questions
          where id = $1
          limit 1
        `,
        [questionId],
      )
      return rows[0] ? mapQuestionRow(rows[0] as QuestionRow) : undefined
    },

    async getApprovedQuestions() {
      return this.listQuestions()
    },

    async getQuestionCounts() {
      const rows = await query(`
        select topic_id, count(*)::int as question_count
        from app_public_questions
        group by topic_id
        order by topic_id
      `)

      return rows.reduce<QuestionCounts>(
        (counts, row) => {
          const topicId = String(row.topic_id)
          const count = Number(row.question_count ?? 0)

          counts.byTopic[topicId] = count
          counts.total += count
          return counts
        },
        {
          byTopic: {},
          total: 0,
        },
      )
    },

    async listQuestions() {
      const rows = await query(`
        select *
        from app_public_questions
        order by topic_id, title, id
      `)
      return rows.map((row) => mapQuestionRow(row as QuestionRow))
    },

    async listQuestionsByTopic(topicId) {
      const rows = await query(
        `
          select *
          from app_public_questions
          where topic_id = $1
          order by title, id
        `,
        [topicId],
      )
      return rows.map((row) => mapQuestionRow(row as QuestionRow))
    },

    async getRetrievalChunks() {
      const rows = await query(`
        select *
        from app_student_retrieval_chunks
        order by priority_rank, topic_id, title, id
      `)
      return rows.map((row) => mapRetrievalChunkRow(row as RetrievalChunkRow))
    },

    async getReviewQueue() {
      const rows = await query(`
        select *
        from app_review_queue_questions
        order by created_at, id
      `)
      return rows.map((row) => mapReviewCandidateRow(row as QuestionRow))
    },

    async getTopics() {
      return this.listTopics()
    },

    async listTopics() {
      const rows = await query(`
        select id, title, description
        from topics
        order by sort_order, title, id
      `)
      return rows.map((row) => ({
        description: String(row.description ?? ""),
        id: String(row.id),
        title: String(row.title),
      }))
    },

    async updateReviewCandidateStatus(candidateId, action, reviewedBy) {
      const status = reviewStatusForAction(action)
      const updatedRows = await query(
        `
          update questions
          set review_status = $2,
              reviewed_by = $3,
              reviewed_at = now(),
              updated_at = now()
          where id = $1
            and visibility = 'public'
            and trust_level = 'generated_unverified'
            and review_status in ('needs_review', 'needs_edit', 'needs_regeneration')
          returning *
        `,
        [candidateId, status, reviewedBy ?? "professor"],
      )

      const updated = updatedRows[0] as QuestionRow | undefined

      if (!updated) {
        return undefined
      }

      const rows = await query(
        `
          select
            q.*,
            coalesce(q.pattern_id, q.source_type) as pattern_source,
            coalesce(
              (
                select jsonb_agg(h.body order by h.hint_order)
                from hints h
                where h.question_id = q.id
              ),
              '[]'::jsonb
            ) as hints_json,
            coalesce(
              (
                select jsonb_agg(s.body order by s.step_order)
                from solution_steps s
                where s.question_id = q.id
              ),
              '[]'::jsonb
            ) as solution_steps_json,
            coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'id', m.id,
                    'feedback', m.feedback,
                    'matchTerms', m.match_terms_json
                  )
                  order by m.id
                )
                from misconceptions m
                where m.question_id = q.id
              ),
              '[]'::jsonb
            ) as misconceptions_json
          from questions q
          where q.id = $1
          limit 1
        `,
        [candidateId],
      )

      return mapReviewCandidateRow((rows[0] ?? updated) as QuestionRow)
    },
  }
}

export function mapQuestionRow(row: QuestionRow): TutorQuestion {
  return {
    id: row.id,
    topicId: row.topic_id,
    title: row.title,
    difficulty: row.difficulty,
    prompt: row.prompt,
    answer: {
      acceptedAnswers: stringArray(row.accepted_answers_json),
      explanation: row.answer_explanation,
      numericValue: row.numeric_value ?? undefined,
      tolerance: row.tolerance ?? undefined,
    },
    hints: stringArray(row.hints_json),
    solutionSteps: stringArray(row.solution_steps_json),
    misconceptions: misconceptionArray(row.misconceptions_json),
    source: {
      originalityNote: row.originality_note ?? undefined,
      patternIds: row.pattern_id ? [row.pattern_id] : undefined,
      sourceType: row.source_type,
      trustLevel: row.trust_level,
      visibility: row.visibility,
    },
    review: {
      notes: undefined,
      reviewedAt: toIsoString(row.reviewed_at),
      reviewedBy: row.reviewed_by ?? undefined,
      status: row.review_status,
    },
  }
}

export function mapRetrievalChunkRow(row: RetrievalChunkRow): RetrievalChunk {
  return {
    id: row.id,
    topicId: row.topic_id,
    chunkType: row.chunk_type,
    title: row.title,
    body: row.body,
    keywords: stringArray(row.keywords_json),
    formulaRefs: stringArray(row.formula_refs_json),
    conceptTags: stringArray(row.concept_tags_json),
    priorityTier: row.priority_tier,
    questionId: row.question_id ?? undefined,
    difficulty: row.difficulty ?? undefined,
    llmSafeSummary: row.llm_safe_summary ?? undefined,
    embeddingModel: row.embedding_model ?? undefined,
    contentHash: row.content_hash ?? undefined,
    source: {
      sourceType: row.source_type,
      trustLevel: row.trust_level,
      visibility: row.visibility,
    },
    review: {
      status: row.review_status,
    },
  }
}

function mapReviewCandidateRow(row: QuestionRow): ReviewCandidate {
  const question = mapQuestionRow(row)

  return {
    ...question,
    patternSource: row.pattern_source ?? row.pattern_id ?? row.source_type,
  }
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === "string")
}

function misconceptionArray(value: unknown): Misconception[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter(
      (item): item is Misconception =>
        item !== null &&
        typeof item === "object" &&
        "id" in item &&
        "feedback" in item,
    )
    .map((item) => ({
      feedback: String(item.feedback),
      id: String(item.id),
      matchTerms: Array.isArray(item.matchTerms)
        ? item.matchTerms.filter(
            (term): term is string => typeof term === "string",
          )
        : [],
    }))
}

function toIsoString(value: Date | string | null) {
  if (!value) {
    return undefined
  }

  return value instanceof Date ? value.toISOString() : value
}

function createUnavailableQueryExecutor(databaseUrl: string): QueryExecutor {
  return async () => {
    const host = new URL(databaseUrl).host
    throw new Error(
      `Database repository selected for ${host}, but no Postgres driver is configured. Add a server-only query executor or keep APP_DEMO_MODE=true for demo fallback.`,
    )
  }
}

export function approvedPublicWhereClauseForTests() {
  return APPROVED_PUBLIC_WHERE
}
