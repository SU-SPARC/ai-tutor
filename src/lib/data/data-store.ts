import "server-only"

import { createDatabaseContentRepository } from "@/lib/data/database-repository"
import {
  demoContentRepository,
  isStudentFacingQuestion,
  isStudentFacingRetrievalChunk,
  resetDemoReviewQueueForTests,
} from "@/lib/data/demo-repository"
import { queryPostgres } from "@/lib/data/postgres"
import type {
  AdminQuestionDetailUpdate,
  AdminQuestionFilters,
  AdminQuestionRegenerationInput,
  AdminQuestionUpdate,
  ContentRepository,
  DataRepositoryMetadata,
  ReviewCandidateUpdate,
  ReviewQueueFilters,
  ReviewAction,
} from "@/lib/data/repository"
import type { AdminQuestionDashboard, ReviewCandidate } from "@/lib/types"
import { getServerEnv } from "@/lib/env/server"

let contentRepositoryOverride: ContentRepository | undefined

export async function listTopics() {
  return readWithDemoFallback((repository) => repository.listTopics())
}

export async function listQuestions() {
  return readWithDemoFallback((repository) => repository.listQuestions())
}

export async function getAdminQuestionDashboard(
  filters?: AdminQuestionFilters,
): Promise<AdminQuestionDashboard> {
  const env = getServerEnv()
  const topics = await listTopics()

  if (contentRepositoryOverride) {
    return {
      mode: "demo",
      questions: await contentRepositoryOverride.getAdminQuestions(filters),
      readOnly: false,
      sections: buildAdminQuestionSections(
        await contentRepositoryOverride.getAdminQuestions(filters),
      ),
      topics: safeTopicOptions(topics),
    }
  }

  if (env.APP_DEMO_MODE || !env.DATABASE_URL) {
    const questions = await demoContentRepository.getAdminQuestions(filters)
    return {
      mode: "demo",
      questions,
      readOnly: true,
      readOnlyReason:
        env.APP_DEMO_MODE || !env.DATABASE_URL
          ? "Database-backed admin review is unavailable, so demo data is read-only."
          : undefined,
      sections: buildAdminQuestionSections(questions),
      topics: safeTopicOptions(topics),
    }
  }

  try {
    const repository = createDatabaseContentRepository(
      env.DATABASE_URL,
      queryPostgres,
    )
    const questions = await repository.getAdminQuestions(filters)
    return {
      mode: "database",
      questions,
      readOnly: false,
      sections: buildAdminQuestionSections(questions),
      topics: safeTopicOptions(topics),
    }
  } catch {
    const questions = await demoContentRepository.getAdminQuestions(filters)
    return {
      mode: "demo",
      questions,
      readOnly: true,
      readOnlyReason:
        "Database-backed admin review is unavailable, so demo data is read-only.",
      sections: buildAdminQuestionSections(questions),
      topics: safeTopicOptions(topics),
    }
  }
}

export async function updateAdminQuestionsStrict(input: AdminQuestionUpdate) {
  if (contentRepositoryOverride) {
    return contentRepositoryOverride.updateAdminQuestions(input)
  }

  const env = getServerEnv()

  if (env.APP_DEMO_MODE || !env.DATABASE_URL) {
    throw new Error("Admin question mutations require a configured database.")
  }

  return createDatabaseContentRepository(
    env.DATABASE_URL,
    queryPostgres,
  ).updateAdminQuestions(input)
}

export async function updateAdminQuestionDetailStrict(
  questionId: string,
  input: AdminQuestionDetailUpdate,
) {
  if (contentRepositoryOverride) {
    return contentRepositoryOverride.updateAdminQuestionDetail(questionId, input)
  }

  const env = getServerEnv()

  if (env.APP_DEMO_MODE || !env.DATABASE_URL) {
    throw new Error("Admin question mutations require a configured database.")
  }

  return createDatabaseContentRepository(
    env.DATABASE_URL,
    queryPostgres,
  ).updateAdminQuestionDetail(questionId, input)
}

export async function regenerateAdminQuestionStrict(
  input: AdminQuestionRegenerationInput,
) {
  if (contentRepositoryOverride) {
    return contentRepositoryOverride.regenerateAdminQuestion(input)
  }

  const env = getServerEnv()

  if (env.APP_DEMO_MODE || !env.DATABASE_URL) {
    throw new Error("Admin question regeneration requires a configured database.")
  }

  return createDatabaseContentRepository(
    env.DATABASE_URL,
    queryPostgres,
  ).regenerateAdminQuestion(input)
}

export async function getQuestionById(questionId: string) {
  return readWithDemoFallback((repository) =>
    repository.getQuestionById(questionId),
  )
}

export async function listQuestionsByTopic(topicId: string) {
  return readWithDemoFallback((repository) =>
    repository.listQuestionsByTopic(topicId),
  )
}

export async function getQuestionCounts() {
  return readWithDemoFallback((repository) => repository.getQuestionCounts())
}

export async function getProfessorPracticeAnalytics() {
  return readWithDemoFallback((repository) =>
    repository.getProfessorPracticeAnalytics(),
  )
}

export async function getTopics() {
  return listTopics()
}

export async function getApprovedQuestions() {
  return listQuestions()
}

export async function getApprovedQuestionById(questionId: string) {
  return getQuestionById(questionId)
}

export async function getRetrievalChunks() {
  return readWithDemoFallback((repository) => repository.getRetrievalChunks())
}

export async function getReviewQueue(filters?: ReviewQueueFilters) {
  return readWithDemoFallback((repository) => repository.getReviewQueue(filters))
}

export async function importReviewCandidates(
  candidates: ReviewCandidate[],
  reviewedBy?: string,
) {
  return writeWithDemoFallback((repository) =>
    repository.importReviewCandidates(candidates, reviewedBy),
  )
}

export async function updateReviewCandidates(input: ReviewCandidateUpdate) {
  return writeWithDemoFallback((repository) =>
    repository.updateReviewCandidates(input),
  )
}

export async function updateReviewCandidateStatus(
  candidateId: string,
  action: ReviewAction,
  reviewedBy?: string,
) {
  return writeWithDemoFallback((repository) =>
    repository.updateReviewCandidateStatus(candidateId, action, reviewedBy),
  )
}

export function getContentRepository() {
  if (contentRepositoryOverride) {
    return contentRepositoryOverride
  }

  const env = getServerEnv()

  if (env.APP_DEMO_MODE || !env.DATABASE_URL) {
    return demoContentRepository
  }

  return createDatabaseContentRepository(env.DATABASE_URL, queryPostgres)
}

export function getContentRepositoryMode() {
  const env = getServerEnv()
  return env.APP_DEMO_MODE || !env.DATABASE_URL ? "demo" : "database"
}

export function getDataRepositoryMetadata(): DataRepositoryMetadata {
  const env = getServerEnv()
  const databaseConfigured = Boolean(env.DATABASE_URL)

  if (env.APP_DEMO_MODE) {
    return {
      databaseConfigured,
      demoFallbackEnabled: true,
      mode: "demo",
      reason: "APP_DEMO_MODE is enabled, so public demo JSON is the active source.",
      source: "demo-json",
    }
  }

  if (!env.DATABASE_URL) {
    return {
      databaseConfigured: false,
      demoFallbackEnabled: true,
      mode: "demo",
      reason: "DATABASE_URL is not configured, so public demo JSON is the active source.",
      source: "demo-json",
    }
  }

  return {
    databaseConfigured: true,
    demoFallbackEnabled: true,
    mode: "database",
    reason:
      "DATABASE_URL is configured; public demo JSON remains the fallback if database reads are unavailable.",
    source: "postgres",
  }
}

export function setContentRepositoryForTests(
  repository: ContentRepository | undefined,
) {
  contentRepositoryOverride = repository
}

export function resetReviewQueueForTests() {
  resetDemoReviewQueueForTests()
}

function buildAdminQuestionSections(
  questions: AdminQuestionDashboard["questions"],
): AdminQuestionDashboard["sections"] {
  return {
    approved_student_facing: questions
      .filter(isStudentFacingQuestion)
      .map((question) => question.id),
    generated_original: questions
      .filter((question) => question.source.sourceType === "generated_original")
      .map((question) => question.id),
    pattern_derived_original_candidates: questions
      .filter(
        (question) =>
          question.source.sourceType === "pattern_derived_original" &&
          question.review.status !== "approved",
      )
      .map((question) => question.id),
    professor_provided: questions
      .filter((question) => question.source.sourceType === "professor_provided")
      .map((question) => question.id),
  }
}

function safeTopicOptions(topics: AdminQuestionDashboard["topics"]) {
  return topics.map((topic) => ({
    id: topic.id,
    title: topic.title,
  }))
}

async function readWithDemoFallback<T>(
  read: (repository: ContentRepository) => Promise<T>,
) {
  if (contentRepositoryOverride) {
    return read(contentRepositoryOverride)
  }

  const env = getServerEnv()

  if (env.APP_DEMO_MODE || !env.DATABASE_URL) {
    return read(demoContentRepository)
  }

  try {
    return await read(createDatabaseContentRepository(env.DATABASE_URL, queryPostgres))
  } catch {
    return read(demoContentRepository)
  }
}

async function writeWithDemoFallback<T>(
  write: (repository: ContentRepository) => Promise<T>,
) {
  if (contentRepositoryOverride) {
    return write(contentRepositoryOverride)
  }

  const env = getServerEnv()

  if (env.APP_DEMO_MODE || !env.DATABASE_URL) {
    return write(demoContentRepository)
  }

  try {
    return await write(createDatabaseContentRepository(env.DATABASE_URL, queryPostgres))
  } catch {
    return write(demoContentRepository)
  }
}

export { isStudentFacingQuestion, isStudentFacingRetrievalChunk }
