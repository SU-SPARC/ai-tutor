import "server-only"

import { createDatabaseContentRepository } from "@/lib/data/database-repository"
import {
  demoContentRepository,
  isStudentFacingQuestion,
  isStudentFacingRetrievalChunk,
  resetDemoReviewQueueForTests,
} from "@/lib/data/demo-repository"
import type {
  ContentRepository,
  DataRepositoryMetadata,
  ReviewAction,
} from "@/lib/data/repository"
import { getServerEnv } from "@/lib/env/server"

let contentRepositoryOverride: ContentRepository | undefined

export async function listTopics() {
  return readWithDemoFallback((repository) => repository.listTopics())
}

export async function listQuestions() {
  return readWithDemoFallback((repository) => repository.listQuestions())
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

export async function getReviewQueue() {
  return readWithDemoFallback((repository) => repository.getReviewQueue())
}

export async function updateReviewCandidateStatus(
  candidateId: string,
  action: ReviewAction,
  reviewedBy?: string,
) {
  return readWithDemoFallback((repository) =>
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

  return createDatabaseContentRepository(env.DATABASE_URL)
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
    return await read(createDatabaseContentRepository(env.DATABASE_URL))
  } catch {
    return read(demoContentRepository)
  }
}

export { isStudentFacingQuestion, isStudentFacingRetrievalChunk }
