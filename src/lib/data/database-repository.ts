import "server-only"

import {
  reviewStatusForAction,
  type AdminQuestionDetailAction,
  type AdminQuestionDetailUpdate,
  type AdminQuestionFilters,
  type AdminQuestionRegenerationInput,
  type AdminQuestionRegenerationResult,
  type AdminQuestionUpdate,
  type ContentRepository,
  type QuestionCounts,
  type ReviewCandidateImport,
  type ReviewCandidateUpdate,
  type ReviewQueueFilters,
} from "@/lib/data/repository"
import type {
  AdminQuestion,
  Difficulty,
  GeneratedQuestionReviewOutcomes,
  Misconception,
  ProfessorPracticeAnalytics,
  RetrievalChunk,
  RetrievalChunkType,
  RetrievalPriorityTier,
  ReviewCandidate,
  ReviewMetadata,
  ReviewPriority,
  SourceMetadata,
  TutorQuestion,
} from "@/lib/types"
import { generateDeterministicRegeneratedQuestion } from "@/lib/tutor/generated-question-regeneration"
import { emptyGeneratedQuestionReviewOutcomes } from "@/lib/tutor/professor-admin"

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
  review_notes?: string | null
  review_priority?: ReviewPriority | null
  review_status: ReviewMetadata["status"]
  solution_steps_json: unknown
  source_type: SourceMetadata["sourceType"]
  title: string
  topic_title?: string | null
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
const ADMIN_SAFE_TEXT_PREDICATE = `concat_ws(' ', q.prompt, q.answer_explanation, q.originality_note, q.review_notes) !~*
      '(source page|answer key|solution key|worked example|copied from|verbatim|raw extracted|private chunk|embedding|textbook page|professor-only)'`

export function createDatabaseContentRepository(
  databaseUrl: string,
  query: QueryExecutor = createUnavailableQueryExecutor(databaseUrl),
): ContentRepository {
  return {
    async getAdminQuestions(filters) {
      const { params, sql } = adminQuestionQuery(filters)
      const rows = await query(sql, params)
      return rows.map((row) => mapAdminQuestionRow(row as QuestionRow))
    },

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

    async getProfessorPracticeAnalytics() {
      const [
        questionRows,
        summaryRows,
        misconceptionRows,
        generatedRows,
      ] = await Promise.all([
        query(`
          select
            q.id as question_id,
            q.title as question_title,
            q.topic_id,
            t.title as topic_title,
            coalesce(attempts.attempt_count, 0)::int as attempts,
            coalesce(attempts.correct_attempts, 0)::int as correct_attempts,
            coalesce(attempts.llm_attempts, 0)::int as llm_attempts,
            coalesce(sessions.hints_used, 0)::int as hints_used,
            coalesce(sessions.steps_revealed, 0)::int as steps_revealed
          from app_public_questions q
          join topics t on t.id = q.topic_id
          left join (
            select
              question_id,
              count(*)::int as attempt_count,
              count(*) filter (where verdict = 'correct')::int as correct_attempts,
              count(*) filter (where source = 'llm')::int as llm_attempts
            from attempts
            where question_id is not null
            group by question_id
          ) attempts on attempts.question_id = q.id
          left join (
            select
              question_id,
              sum(revealed_hints)::int as hints_used,
              sum(revealed_steps)::int as steps_revealed
            from tutor_sessions
            where question_id is not null
            group by question_id
          ) sessions on sessions.question_id = q.id
          order by t.title, q.title, q.id
        `),
        query(`
          select
            (select count(*)::int from tutor_sessions) as total_tutor_sessions,
            (select count(*)::int from attempts) as total_attempts,
            (select coalesce(sum(revealed_hints), 0)::int from tutor_sessions) as total_hints_used,
            (select coalesce(sum(revealed_steps), 0)::int from tutor_sessions) as total_steps_revealed
        `),
        query(`
          with missed as (
            select
              question_id,
              count(*) filter (where verdict = 'incorrect')::int as missed_attempts
            from attempts
            where question_id is not null
            group by question_id
          )
          select
            m.id as misconception_id,
            m.feedback,
            q.id as question_id,
            q.title as question_title,
            q.topic_id,
            t.title as topic_title,
            missed.missed_attempts
          from misconceptions m
          join app_public_questions q on q.id = m.question_id
          join topics t on t.id = q.topic_id
          join missed on missed.question_id = q.id
          where missed.missed_attempts > 0
          order by missed.missed_attempts desc, t.title, q.title, m.id
          limit 20
        `),
        query(`
          select review_status, count(*)::int as question_count
          from questions
          where visibility = 'public'
            and source_type in ('generated_original', 'pattern_derived_original')
          group by review_status
        `),
      ])
      const questions = questionRows.map((row) => ({
        attempts: Number(row.attempts ?? 0),
        correctAttempts: Number(row.correct_attempts ?? 0),
        hintsUsed: Number(row.hints_used ?? 0),
        llmAttempts: Number(row.llm_attempts ?? 0),
        questionId: String(row.question_id),
        questionTitle: String(row.question_title),
        stepsRevealed: Number(row.steps_revealed ?? 0),
        topicId: String(row.topic_id),
        topicTitle: String(row.topic_title),
      }))
      const byTopic = new Map<
        string,
        ProfessorPracticeAnalytics["topics"][number]
      >()

      for (const question of questions) {
        const current =
          byTopic.get(question.topicId) ??
          {
            attempts: 0,
            correctAttempts: 0,
            hintsUsed: 0,
            llmAttempts: 0,
            stepsRevealed: 0,
            topicId: question.topicId,
            topicTitle: question.topicTitle,
          }

        current.attempts += question.attempts
        current.correctAttempts += question.correctAttempts
        current.hintsUsed += question.hintsUsed
        current.llmAttempts += question.llmAttempts
        current.stepsRevealed += question.stepsRevealed
        byTopic.set(question.topicId, current)
      }
      const generatedQuestionOutcomes =
        generatedRows.reduce<GeneratedQuestionReviewOutcomes>(
          (counts, row) => {
            const status = String(row.review_status)

            if (status in counts) {
              counts[status as keyof GeneratedQuestionReviewOutcomes] = Number(
                row.question_count ?? 0,
              )
            }

            return counts
          },
          emptyGeneratedQuestionReviewOutcomes(),
        )
      const summary = summaryRows[0]

      return {
        commonMisconceptions: misconceptionRows.map((row) => ({
          feedback: String(row.feedback),
          misconceptionId: String(row.misconception_id),
          missedAttempts: Number(row.missed_attempts ?? 0),
          questionId: String(row.question_id),
          questionTitle: String(row.question_title),
          topicId: String(row.topic_id),
          topicTitle: String(row.topic_title),
        })),
        generatedQuestionOutcomes,
        mode: "database",
        questions,
        summary: {
          totalAttempts: Number(summary?.total_attempts ?? 0),
          totalHintsUsed: Number(summary?.total_hints_used ?? 0),
          totalStepsRevealed: Number(summary?.total_steps_revealed ?? 0),
          totalTutorSessions: Number(summary?.total_tutor_sessions ?? 0),
        },
        topics: [...byTopic.values()],
      }
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

    async getReviewQueue(filters) {
      const { params, sql } = reviewQueueQuery(filters)
      const rows = await query(sql, params)
      return rows.map((row) => mapReviewCandidateRow(row as QuestionRow))
    },

    async importReviewCandidates(candidates) {
      const imported: ReviewCandidate[] = []

      for (const candidate of candidates) {
        await query(
          `
            insert into topics (id, title, description)
            values ($1, $2, '')
            on conflict (id) do nothing
          `,
          [candidate.topicId, candidate.topic ?? candidate.topicId],
        )

        const rows = await query(
          `
            insert into questions (
              id,
              topic_id,
              pattern_id,
              title,
              prompt,
              difficulty,
              accepted_answers_json,
              numeric_value,
              tolerance,
              answer_explanation,
              source_type,
              trust_level,
              visibility,
              review_status,
              originality_note,
              review_priority,
              review_notes
            )
            values (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7::jsonb,
              $8,
              $9,
              $10,
              $11,
              'generated_unverified',
              'public',
              'needs_review',
              $12,
              $13,
              $14
            )
            on conflict (id) do update set
              topic_id = excluded.topic_id,
              pattern_id = excluded.pattern_id,
              title = excluded.title,
              prompt = excluded.prompt,
              difficulty = excluded.difficulty,
              accepted_answers_json = excluded.accepted_answers_json,
              numeric_value = excluded.numeric_value,
              tolerance = excluded.tolerance,
              answer_explanation = excluded.answer_explanation,
              source_type = excluded.source_type,
              trust_level = excluded.trust_level,
              visibility = excluded.visibility,
              review_status = excluded.review_status,
              originality_note = excluded.originality_note,
              review_priority = excluded.review_priority,
              review_notes = excluded.review_notes,
              updated_at = now()
            where questions.trust_level = 'generated_unverified'
              and questions.review_status in ('needs_review', 'needs_edit', 'needs_regeneration')
            returning *
          `,
          [
            candidate.id,
            candidate.topicId,
            candidate.source.patternIds?.[0] ?? candidate.patternSource,
            candidate.title,
            candidate.prompt,
            candidate.difficulty,
            JSON.stringify(candidate.answer.acceptedAnswers),
            candidate.answer.numericValue ?? null,
            candidate.answer.tolerance ?? null,
            candidate.answer.explanation,
            candidate.source.sourceType,
            candidate.source.originalityNote ?? null,
            candidate.review.reviewPriority ?? "normal",
            candidate.review.notes ?? null,
          ],
        )

        if (!rows[0]) {
          continue
        }

        await replaceQuestionChildren(query, candidate)
        imported.push(candidate)
      }

      return {
        candidates: imported,
        imported: true,
        message: `Imported ${imported.length} generated review candidate(s).`,
        mode: "database",
        nonDurable: false,
      } satisfies ReviewCandidateImport
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

    async updateReviewCandidates(input: ReviewCandidateUpdate) {
      if (input.candidateIds.length === 0) {
        return []
      }

      const status = input.action
        ? reviewStatusForAction(input.action)
        : undefined
      await query(
        `
          update questions
          set review_status = coalesce($2, review_status),
              trust_level = case
                when $2 = 'approved' then 'professor_approved'
                else trust_level
              end,
              topic_id = coalesce($3, topic_id),
              difficulty = coalesce($4, difficulty),
              review_priority = coalesce($5, review_priority),
              review_notes = coalesce($6, review_notes),
              reviewed_by = case
                when $8 then $7
                else reviewed_by
              end,
              reviewed_at = case
                when $2 is not null then now()
                else reviewed_at
              end,
              updated_at = now()
          where id = any($1)
            and visibility = 'public'
            and source_type in ('generated_original', 'pattern_derived_original')
            and trust_level = 'generated_unverified'
            and review_status in ('needs_review', 'needs_edit', 'needs_regeneration')
        `,
        [
          input.candidateIds,
          status ?? null,
          input.topicId ?? null,
          input.difficulty ?? null,
          input.reviewPriority ?? null,
          input.notes ?? null,
          input.reviewedBy ?? "professor",
          Boolean(
            status ||
              input.notes !== undefined ||
              input.reviewPriority ||
              input.topicId ||
              input.difficulty,
          ),
        ],
      )

      return selectReviewCandidateRowsByIds(query, input.candidateIds)
    },

    async updateAdminQuestions(input: AdminQuestionUpdate) {
      if (input.questionIds.length === 0) {
        return []
      }

      const status = adminReviewStatusForAction(input.action)
      const onlyGenerated = input.action === "request_regeneration"
      await query(
        `
          update questions
          set review_status = $2,
              trust_level = case
                when source_type in ('generated_original', 'pattern_derived_original')
                  and $2 = 'approved'
                  then 'professor_approved'
                when source_type in ('generated_original', 'pattern_derived_original')
                  and $2 in ('needs_review', 'rejected', 'needs_regeneration')
                  then 'generated_unverified'
                else trust_level
              end,
              reviewed_by = $3,
              reviewed_at = now(),
              updated_at = now()
          where id = any($1)
            and visibility = 'public'
            and source_type <> 'private_reference_pattern'
            and ($4 = false or source_type in ('generated_original', 'pattern_derived_original'))
        `,
        [
          input.questionIds,
          status,
          input.reviewedBy ?? "admin",
          onlyGenerated,
        ],
      )

      return selectAdminQuestionRowsByIds(query, input.questionIds)
    },

    async updateAdminQuestionDetail(
      questionId: string,
      input: AdminQuestionDetailUpdate,
    ) {
      const current = await selectEditableAdminQuestionRowById(query, questionId)

      if (!current) {
        return undefined
      }

      const generatedQuestion = isGeneratedAdminQuestion(current)

      if (input.action && !generatedQuestion) {
        return undefined
      }

      const actionStatus = input.action
        ? reviewStatusForAdminDetailAction(input.action)
        : undefined
      const nextReviewStatus = actionStatus ?? input.reviewStatus
      let nextTrustLevel = input.trustLevel

      if (generatedQuestion) {
        if (nextReviewStatus === "approved") {
          nextTrustLevel = "professor_approved"
        } else if (nextReviewStatus) {
          nextTrustLevel = "generated_unverified"
        }
      }

      const assignments = ["updated_at = now()"]
      const params: QueryValue[] = [questionId]
      const addAssignment = (column: string, value: QueryValue) => {
        params.push(value)
        assignments.push(`${column} = $${params.length}`)
      }

      if (nextReviewStatus) {
        addAssignment("review_status", nextReviewStatus)
      }

      if (nextTrustLevel) {
        addAssignment("trust_level", nextTrustLevel)
      }

      if (input.topicId !== undefined) {
        addAssignment("topic_id", input.topicId)
      }

      if (input.difficulty !== undefined) {
        addAssignment("difficulty", input.difficulty)
      }

      if (input.reviewerNotes !== undefined) {
        addAssignment("review_notes", input.reviewerNotes.trim() || null)
      }

      if (
        input.action ||
        input.reviewStatus ||
        input.trustLevel ||
        input.reviewerNotes !== undefined ||
        input.topicId !== undefined ||
        input.difficulty !== undefined
      ) {
        addAssignment("reviewed_by", input.reviewedBy ?? "admin")
      }

      if (input.action || input.reviewStatus || input.trustLevel) {
        assignments.push("reviewed_at = now()")
      }

      await query(
        `
          update questions q
          set ${assignments.join(", ")}
          where q.id = $1
            and q.visibility = 'public'
            and q.source_type <> 'private_reference_pattern'
            and ${ADMIN_SAFE_TEXT_PREDICATE}
        `,
        params,
      )

      if (input.hints) {
        await replaceAdminQuestionHints(query, questionId, input.hints)
      }

      if (input.misconceptions) {
        await replaceAdminQuestionMisconceptions(
          query,
          questionId,
          input.misconceptions,
        )
      }

      const updated = await selectAdminQuestionRowsByIds(query, [questionId])
      return updated[0]
    },

    async regenerateAdminQuestion(input: AdminQuestionRegenerationInput) {
      const original = await selectEditableAdminQuestionRowById(
        query,
        input.questionId,
      )

      if (!original || !isGeneratedAdminQuestion(original)) {
        return undefined
      }

      const baseId = `${slugify(original.id)}-regen`
      const sequence = await nextRegenerationSequence(query, baseId)
      const keepPattern = input.keepPattern ?? true
      let regenerated: AdminQuestion | undefined

      for (let offset = 0; offset < 5; offset += 1) {
        const candidate = generateDeterministicRegeneratedQuestion({
          id: `${baseId}-${sequence + offset}`,
          keepPattern,
          original,
          sequence: sequence + offset,
        })

        const rows = await query(
          `
            insert into questions (
              id,
              topic_id,
              pattern_id,
              title,
              prompt,
              difficulty,
              accepted_answers_json,
              numeric_value,
              tolerance,
              answer_explanation,
              source_type,
              trust_level,
              visibility,
              review_status,
              originality_note,
              review_priority,
              review_notes,
              reviewed_by,
              reviewed_at
            )
            values (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7::jsonb,
              $8,
              $9,
              $10,
              $11,
              'generated_unverified',
              'public',
              'needs_review',
              $12,
              $13,
              $14,
              $15,
              now()
            )
            on conflict (id) do nothing
            returning id
          `,
          [
            candidate.id,
            candidate.topicId,
            candidate.source.patternIds?.[0] ?? null,
            candidate.title,
            candidate.prompt,
            candidate.difficulty,
            JSON.stringify(candidate.answer.acceptedAnswers),
            candidate.answer.numericValue ?? null,
            candidate.answer.tolerance ?? null,
            candidate.answer.explanation,
            candidate.source.sourceType,
            candidate.source.originalityNote ?? null,
            candidate.review.reviewPriority ?? "normal",
            candidate.review.notes ?? null,
            input.reviewedBy ?? "admin",
          ],
        )

        if (!rows[0]) {
          continue
        }

        await replaceQuestionChildren(query, candidate)
        regenerated = (await selectAdminQuestionRowsByIds(query, [candidate.id]))[0]
        break
      }

      if (!regenerated) {
        return undefined
      }

      await query(
        `
          update questions
          set review_status = 'needs_regeneration',
              trust_level = 'generated_unverified',
              review_notes = $2,
              reviewed_by = $3,
              reviewed_at = now(),
              updated_at = now()
          where id = $1
            and visibility = 'public'
            and source_type in ('generated_original', 'pattern_derived_original')
        `,
        [
          original.id,
          `Regenerated into ${regenerated.id}; old version preserved for audit.`,
          input.reviewedBy ?? "admin",
        ],
      )

      const updatedOriginal = (
        await selectAdminQuestionRowsByIds(query, [original.id])
      )[0]

      if (!updatedOriginal) {
        return undefined
      }

      return {
        mode: "deterministic",
        original: updatedOriginal,
        preservedOriginal: true,
        regenerated,
      } satisfies AdminQuestionRegenerationResult
    },

    async updateReviewCandidateStatus(candidateId, action, reviewedBy) {
      const updated = await this.updateReviewCandidates({
        action,
        candidateIds: [candidateId],
        reviewedBy,
      })
      return updated[0]
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
      notes: row.review_notes ?? undefined,
      reviewedAt: toIsoString(row.reviewed_at),
      reviewedBy: row.reviewed_by ?? undefined,
      reviewPriority: row.review_priority ?? "normal",
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

function mapAdminQuestionRow(row: QuestionRow): AdminQuestion {
  return {
    ...mapQuestionRow(row),
    patternSource: row.pattern_source ?? row.pattern_id ?? row.source_type,
    topicTitle: row.topic_title ?? undefined,
  }
}

function mapReviewCandidateRow(row: QuestionRow): ReviewCandidate {
  const question = mapQuestionRow(row)

  return {
    ...question,
    patternSource: row.pattern_source ?? row.pattern_id ?? row.source_type,
  }
}

function adminQuestionQuery(filters: AdminQuestionFilters = {}) {
  const clauses = [
    "q.visibility = 'public'",
    "q.source_type <> 'private_reference_pattern'",
    ADMIN_SAFE_TEXT_PREDICATE,
  ]
  const params: QueryValue[] = []

  if (filters.status) {
    params.push(filters.status)
    clauses.push(`q.review_status = $${params.length}`)
  }

  if (filters.topicId) {
    params.push(filters.topicId)
    clauses.push(`q.topic_id = $${params.length}`)
  }

  if (filters.sourceType) {
    params.push(filters.sourceType)
    clauses.push(`q.source_type = $${params.length}`)
  }

  if (filters.generatedOnly) {
    clauses.push(
      "q.source_type in ('generated_original', 'pattern_derived_original')",
    )
  }

  return {
    params,
    sql: adminQuestionSelectSql(`where ${clauses.join(" and ")}`),
  }
}

function reviewQueueQuery(filters: ReviewQueueFilters = {}) {
  const clauses = ["1 = 1"]
  const params: QueryValue[] = []

  if (filters.status) {
    params.push(filters.status)
    clauses.push(`review_status = $${params.length}`)
  }

  if (filters.reviewPriority) {
    params.push(filters.reviewPriority)
    clauses.push(`coalesce(review_priority, 'normal') = $${params.length}`)
  }

  if (filters.difficulty) {
    params.push(filters.difficulty)
    clauses.push(`difficulty = $${params.length}`)
  }

  if (filters.topicId) {
    params.push(filters.topicId)
    clauses.push(`topic_id = $${params.length}`)
  }

  return {
    params,
    sql: `
      select *
      from app_review_queue_questions
      where ${clauses.join(" and ")}
      order by coalesce(review_priority, 'normal') desc, created_at, id
    `,
  }
}

async function selectReviewCandidateRowsByIds(
  query: QueryExecutor,
  candidateIds: string[],
) {
  if (candidateIds.length === 0) {
    return []
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
      where q.id = any($1)
      order by array_position($1, q.id)
    `,
    [candidateIds],
  )

  return rows.map((row) => mapReviewCandidateRow(row as QuestionRow))
}

async function selectAdminQuestionRowsByIds(
  query: QueryExecutor,
  questionIds: string[],
) {
  if (questionIds.length === 0) {
    return []
  }

  const rows = await query(
    adminQuestionSelectSql(
      `where q.id = any($1)
        and q.visibility = 'public'
        and q.source_type <> 'private_reference_pattern'
        and ${ADMIN_SAFE_TEXT_PREDICATE}`,
    ),
    [questionIds],
  )

  return rows.map((row) => mapAdminQuestionRow(row as QuestionRow))
}

async function selectEditableAdminQuestionRowById(
  query: QueryExecutor,
  questionId: string,
) {
  const rows = await query(
    adminQuestionSelectSql(
      `where q.id = $1
        and q.visibility = 'public'
        and q.source_type <> 'private_reference_pattern'
        and ${ADMIN_SAFE_TEXT_PREDICATE}`,
    ),
    [questionId],
  )

  return rows[0] ? mapAdminQuestionRow(rows[0] as QuestionRow) : undefined
}

function adminQuestionSelectSql(whereClause: string) {
  return `
    select
      q.*,
      t.title as topic_title,
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
    left join topics t on t.id = q.topic_id
    ${whereClause}
    order by q.review_status, q.source_type, q.topic_id, q.title, q.id
  `
}

function adminReviewStatusForAction(action: AdminQuestionUpdate["action"]) {
  if (action === "mark_needs_review") {
    return "needs_review"
  }

  return reviewStatusForAction(action)
}

function reviewStatusForAdminDetailAction(
  action: AdminQuestionDetailAction,
): ReviewMetadata["status"] {
  if (action === "approve_generated") {
    return "approved"
  }

  if (action === "request_regeneration") {
    return "needs_regeneration"
  }

  return "rejected"
}

function isGeneratedAdminQuestion(question: AdminQuestion) {
  return (
    question.source.sourceType === "generated_original" ||
    question.source.sourceType === "pattern_derived_original"
  )
}

async function nextRegenerationSequence(query: QueryExecutor, baseId: string) {
  const rows = await query(
    `
      select count(*)::int as regeneration_count
      from questions
      where id like $1
    `,
    [`${baseId}-%`],
  )

  return Number(rows[0]?.regeneration_count ?? 0) + 1
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "generated-question"
  )
}

async function replaceAdminQuestionHints(
  query: QueryExecutor,
  questionId: string,
  hints: string[],
) {
  await query("delete from hints where question_id = $1", [questionId])

  for (const [index, hint] of hints.entries()) {
    await query(
      `
        insert into hints (question_id, hint_order, body)
        values ($1, $2, $3)
      `,
      [questionId, index + 1, hint],
    )
  }
}

async function replaceAdminQuestionMisconceptions(
  query: QueryExecutor,
  questionId: string,
  misconceptions: AdminQuestionDetailUpdate["misconceptions"],
) {
  await query("delete from misconceptions where question_id = $1", [questionId])

  for (const misconception of misconceptions ?? []) {
    await query(
      `
        insert into misconceptions (
          id,
          question_id,
          feedback,
          match_terms_json
        )
        values ($1, $2, $3, $4::jsonb)
      `,
      [
        misconception.id,
        questionId,
        misconception.feedback,
        JSON.stringify(misconception.matchTerms),
      ],
    )
  }
}

async function replaceQuestionChildren(
  query: QueryExecutor,
  candidate: ReviewCandidate,
) {
  await query("delete from hints where question_id = $1", [candidate.id])
  await query("delete from solution_steps where question_id = $1", [candidate.id])
  await query("delete from misconceptions where question_id = $1", [
    candidate.id,
  ])

  for (const [index, hint] of candidate.hints.entries()) {
    await query(
      `
        insert into hints (question_id, hint_order, body)
        values ($1, $2, $3)
      `,
      [candidate.id, index + 1, hint],
    )
  }

  for (const [index, step] of candidate.solutionSteps.entries()) {
    await query(
      `
        insert into solution_steps (question_id, step_order, body)
        values ($1, $2, $3)
      `,
      [candidate.id, index + 1, step],
    )
  }

  for (const misconception of candidate.misconceptions) {
    await query(
      `
        insert into misconceptions (
          id,
          question_id,
          feedback,
          match_terms_json
        )
        values ($1, $2, $3, $4::jsonb)
      `,
      [
        misconception.id,
        candidate.id,
        misconception.feedback,
        JSON.stringify(misconception.matchTerms),
      ],
    )
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
