import "server-only"

import { createDatabaseContentRepository } from "@/lib/data/database-repository"
import {
  demoContentRepository,
  isStudentFacingQuestion,
  isStudentFacingRetrievalChunk,
  resetDemoReviewQueueForTests,
} from "@/lib/data/demo-repository"
import { queryPostgres } from "@/lib/data/postgres"
import { DataServiceUnavailableError } from "@/lib/data/service-error"
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
import { getOperatingModePolicy } from "@/lib/runtime/operating-mode"
import { buildProfessorTopicReviewProgress } from "@/lib/tutor/professor-review-mode"

let contentRepositoryOverride: ContentRepository | undefined

export async function listTopics() {
  return readWithConfiguredRepository((repository) => repository.listTopics())
}

export async function listQuestions() {
  const questions = await readWithConfiguredRepository((repository) =>
    repository.listQuestions(),
  )
  return questions.filter(isStudentFacingQuestion)
}

export async function getAdminQuestionDashboard(
  filters?: AdminQuestionFilters,
): Promise<AdminQuestionDashboard> {
  const env = getServerEnv()
  const policy = getOperatingModePolicy()
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

  if (policy.repositorySource === "demo") {
    return demoAdminQuestionDashboard(filters, topics)
  }

  if (!env.DATABASE_URL) {
    throw new DataServiceUnavailableError("content")
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
  } catch (cause) {
    if (policy.allowDemoFallback) {
      return demoAdminQuestionDashboard(filters, topics, true)
    }

    throw new DataServiceUnavailableError("content", { cause })
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
  const question = await readWithConfiguredRepository((repository) =>
    repository.getQuestionById(questionId),
  )
  return question && isStudentFacingQuestion(question) ? question : undefined
}

export async function listQuestionsByTopic(topicId: string) {
  const questions = await readWithConfiguredRepository((repository) =>
    repository.listQuestionsByTopic(topicId),
  )
  return questions.filter(isStudentFacingQuestion)
}

export async function getQuestionCounts() {
  return readWithConfiguredRepository((repository) =>
    repository.getQuestionCounts(),
  )
}

export async function getProfessorPracticeAnalytics() {
  return readWithConfiguredRepository((repository) =>
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
  return readWithConfiguredRepository((repository) =>
    repository.getRetrievalChunks(),
  )
}

export async function getReviewQueue(filters?: ReviewQueueFilters) {
  return readWithConfiguredRepository((repository) =>
    repository.getReviewQueue(filters),
  )
}

export async function getProfessorTopicReviewProgress(topicId: string) {
  const candidates = await readWithConfiguredRepository((repository) =>
    repository.getAdminQuestions({
      generatedOnly: true,
      topicId,
    }),
  )

  return buildProfessorTopicReviewProgress(topicId, candidates)
}

export async function importReviewCandidates(
  candidates: ReviewCandidate[],
  reviewedBy?: string,
) {
  return writeWithConfiguredRepository((repository) =>
    repository.importReviewCandidates(candidates, reviewedBy),
  )
}

export async function updateReviewCandidates(input: ReviewCandidateUpdate) {
  return writeWithConfiguredRepository((repository) =>
    repository.updateReviewCandidates(input),
  )
}

export async function updateReviewCandidateStatus(
  candidateId: string,
  action: ReviewAction,
  reviewedBy?: string,
) {
  return writeWithConfiguredRepository((repository) =>
    repository.updateReviewCandidateStatus(candidateId, action, reviewedBy),
  )
}

export function getContentRepository() {
  if (contentRepositoryOverride) {
    return contentRepositoryOverride
  }

  const env = getServerEnv()
  const policy = getOperatingModePolicy()

  if (policy.repositorySource === "demo") {
    return demoContentRepository
  }

  if (!env.DATABASE_URL) {
    throw new DataServiceUnavailableError("content")
  }

  return createDatabaseContentRepository(env.DATABASE_URL, queryPostgres)
}

export function getContentRepositoryMode() {
  return getOperatingModePolicy().repositorySource
}

export function getDataRepositoryMetadata(): DataRepositoryMetadata {
  const env = getServerEnv()
  const policy = getOperatingModePolicy()
  const databaseConfigured = Boolean(env.DATABASE_URL)

  if (policy.repositorySource === "demo") {
    return {
      databaseConfigured,
      demoFallbackEnabled: false,
      mode: "demo",
      operatingMode: policy.mode,
      reason: `${policy.mode} intentionally uses committed public demo fixtures.`,
      source: "demo-json",
    }
  }

  return {
    databaseConfigured,
    demoFallbackEnabled: policy.allowDemoFallback,
    mode: "database",
    operatingMode: policy.mode,
    reason: databaseConfigured
      ? policy.allowDemoFallback
        ? "The configured database is active; documented local demo fallback is enabled."
        : "The configured database is required; demo fallback is disabled."
      : "The selected operating mode requires a database, but DATABASE_URL is unavailable.",
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

async function readWithConfiguredRepository<T>(
  read: (repository: ContentRepository) => Promise<T>,
) {
  if (contentRepositoryOverride) {
    return read(contentRepositoryOverride)
  }

  const env = getServerEnv()
  const policy = getOperatingModePolicy()

  if (policy.repositorySource === "demo") {
    return read(demoContentRepository)
  }

  if (!env.DATABASE_URL) {
    throw new DataServiceUnavailableError("content")
  }

  try {
    return await read(
      createDatabaseContentRepository(env.DATABASE_URL, queryPostgres),
    )
  } catch (cause) {
    if (policy.allowDemoFallback) {
      return read(demoContentRepository)
    }

    throw new DataServiceUnavailableError("content", { cause })
  }
}

async function writeWithConfiguredRepository<T>(
  write: (repository: ContentRepository) => Promise<T>,
) {
  if (contentRepositoryOverride) {
    return write(contentRepositoryOverride)
  }

  const env = getServerEnv()
  const policy = getOperatingModePolicy()

  if (policy.repositorySource === "demo") {
    return write(demoContentRepository)
  }

  if (!env.DATABASE_URL) {
    throw new DataServiceUnavailableError("content")
  }

  try {
    return await write(
      createDatabaseContentRepository(env.DATABASE_URL, queryPostgres),
    )
  } catch (cause) {
    if (policy.allowDemoFallback) {
      return write(demoContentRepository)
    }

    throw new DataServiceUnavailableError("content", { cause })
  }
}

async function demoAdminQuestionDashboard(
  filters: AdminQuestionFilters | undefined,
  topics: AdminQuestionDashboard["topics"],
  fallback = false,
): Promise<AdminQuestionDashboard> {
  const questions = await demoContentRepository.getAdminQuestions(filters)

  return {
    mode: "demo",
    questions,
    readOnly: true,
    readOnlyReason: fallback
      ? "The local database is unavailable, so the documented read-only demo fallback is active."
      : "This operating mode uses read-only demo content.",
    sections: buildAdminQuestionSections(questions),
    topics: safeTopicOptions(topics),
  }
}

export { isStudentFacingQuestion, isStudentFacingRetrievalChunk }
