import "server-only";

import {
  assertAuthorization,
  isPublishedContent,
  isRetrievalEligibleContent,
  isStudentSafeRetrievalContent,
  type AnalyticsAuthorization,
  type ProfessorReviewAuthorization,
} from "@/lib/auth/authorization";
import { createDatabaseContentRepository } from "@/lib/data/database-repository";
import {
  demoContentRepository,
  resetDemoReviewQueueForTests,
} from "@/lib/data/demo-repository";
import { queryPostgres } from "@/lib/data/postgres";
import { DataServiceUnavailableError } from "@/lib/data/service-error";
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
} from "@/lib/data/repository";
import type { AdminQuestionDashboard, ReviewCandidate } from "@/lib/types";
import { getServerEnv } from "@/lib/env/server";
import { getOperatingModePolicy } from "@/lib/runtime/operating-mode";
import { buildProfessorTopicReviewProgress } from "@/lib/tutor/professor-review-mode";

let contentRepositoryOverride: ContentRepository | undefined;

export async function listTopics() {
  return readWithConfiguredRepository((repository) => repository.listTopics());
}

export async function listQuestions() {
  const questions = await readWithConfiguredRepository((repository) =>
    repository.listQuestions(),
  );
  return questions.filter(isPublishedContent);
}

export async function getAdminQuestionDashboard(
  authorization: ProfessorReviewAuthorization,
  filters?: AdminQuestionFilters,
): Promise<AdminQuestionDashboard> {
  assertAuthorization(authorization, "professor");
  const env = getServerEnv();
  const policy = getOperatingModePolicy();
  const topics = await listTopics();

  if (contentRepositoryOverride) {
    return {
      mode: "demo",
      questions: await contentRepositoryOverride.getAdminQuestions(
        authorization,
        filters,
      ),
      readOnly: false,
      sections: buildAdminQuestionSections(
        await contentRepositoryOverride.getAdminQuestions(
          authorization,
          filters,
        ),
      ),
      topics: safeTopicOptions(topics),
    };
  }

  if (policy.repositorySource === "demo") {
    return demoAdminQuestionDashboard(authorization, filters, topics);
  }

  if (!env.DATABASE_URL) {
    throw new DataServiceUnavailableError("content");
  }

  try {
    const repository = createDatabaseContentRepository(
      env.DATABASE_URL,
      queryPostgres,
    );
    const questions = await repository.getAdminQuestions(
      authorization,
      filters,
    );
    return {
      mode: "database",
      questions,
      readOnly: false,
      sections: buildAdminQuestionSections(questions),
      topics: safeTopicOptions(topics),
    };
  } catch (cause) {
    if (policy.allowDemoFallback) {
      return demoAdminQuestionDashboard(authorization, filters, topics, true);
    }

    throw new DataServiceUnavailableError("content", { cause });
  }
}

export async function updateAdminQuestionsStrict(
  authorization: ProfessorReviewAuthorization,
  input: AdminQuestionUpdate,
) {
  assertAuthorization(authorization, "professor");
  if (contentRepositoryOverride) {
    return contentRepositoryOverride.updateAdminQuestions(authorization, input);
  }

  return writeStrictDatabase((repository) =>
    repository.updateAdminQuestions(authorization, input),
  );
}

export async function updateAdminQuestionDetailStrict(
  authorization: ProfessorReviewAuthorization,
  questionId: string,
  input: AdminQuestionDetailUpdate,
) {
  assertAuthorization(authorization, "professor");
  if (contentRepositoryOverride) {
    return contentRepositoryOverride.updateAdminQuestionDetail(
      authorization,
      questionId,
      input,
    );
  }

  return writeStrictDatabase((repository) =>
    repository.updateAdminQuestionDetail(authorization, questionId, input),
  );
}

export async function regenerateAdminQuestionStrict(
  authorization: ProfessorReviewAuthorization,
  input: AdminQuestionRegenerationInput,
) {
  assertAuthorization(authorization, "professor");
  if (contentRepositoryOverride) {
    return contentRepositoryOverride.regenerateAdminQuestion(
      authorization,
      input,
    );
  }

  return writeStrictDatabase((repository) =>
    repository.regenerateAdminQuestion(authorization, input),
  );
}

export async function getQuestionById(questionId: string) {
  const question = await readWithConfiguredRepository((repository) =>
    repository.getQuestionById(questionId),
  );
  return question && isPublishedContent(question) ? question : undefined;
}

export async function listQuestionsByTopic(topicId: string) {
  const questions = await readWithConfiguredRepository((repository) =>
    repository.listQuestionsByTopic(topicId),
  );
  return questions.filter(isPublishedContent);
}

export async function getQuestionCounts() {
  return readWithConfiguredRepository((repository) =>
    repository.getQuestionCounts(),
  );
}

export async function getProfessorPracticeAnalytics(
  authorization: AnalyticsAuthorization,
) {
  assertAuthorization(authorization, "professor");
  return readWithConfiguredRepository((repository) =>
    repository.getProfessorPracticeAnalytics(authorization),
  );
}

export async function getTopics() {
  return listTopics();
}

export async function getApprovedQuestions() {
  return listQuestions();
}

export async function getApprovedQuestionById(questionId: string) {
  return getQuestionById(questionId);
}

export async function getRetrievalChunks() {
  const chunks = await readWithConfiguredRepository((repository) =>
    repository.getRetrievalChunks(),
  );
  return chunks.filter(isRetrievalEligibleContent);
}

export async function getReviewQueue(
  authorization: ProfessorReviewAuthorization | AnalyticsAuthorization,
  filters?: ReviewQueueFilters,
) {
  assertAuthorization(authorization, "professor");
  return readWithConfiguredRepository((repository) =>
    repository.getReviewQueue(authorization, filters),
  );
}

export async function getProfessorTopicReviewProgress(
  authorization: ProfessorReviewAuthorization,
  topicId: string,
) {
  assertAuthorization(authorization, "professor");
  const candidates = await readWithConfiguredRepository((repository) =>
    repository.getReviewQueue(authorization, {
      topicId,
    }),
  );

  return buildProfessorTopicReviewProgress(topicId, candidates);
}

export async function importReviewCandidates(
  authorization: ProfessorReviewAuthorization,
  candidates: ReviewCandidate[],
) {
  assertAuthorization(authorization, "professor");
  return writeWithConfiguredRepository((repository) =>
    repository.importReviewCandidates(authorization, candidates),
  );
}

export async function updateReviewCandidates(
  authorization: ProfessorReviewAuthorization,
  input: ReviewCandidateUpdate,
) {
  assertAuthorization(authorization, "professor");
  return writeWithConfiguredRepository((repository) =>
    repository.updateReviewCandidates(authorization, input),
  );
}

export async function updateReviewCandidateStatus(
  authorization: ProfessorReviewAuthorization,
  candidateId: string,
  action: ReviewAction,
) {
  assertAuthorization(authorization, "professor");
  return writeWithConfiguredRepository((repository) =>
    repository.updateReviewCandidateStatus(authorization, candidateId, action),
  );
}

export function getContentRepositoryMode() {
  return getOperatingModePolicy().repositorySource;
}

export function getDataRepositoryMetadata(): DataRepositoryMetadata {
  const env = getServerEnv();
  const policy = getOperatingModePolicy();
  const databaseConfigured = Boolean(env.DATABASE_URL);

  if (policy.repositorySource === "demo") {
    return {
      databaseConfigured,
      demoFallbackEnabled: false,
      mode: "demo",
      operatingMode: policy.mode,
      reason: `${policy.mode} intentionally uses committed public demo fixtures.`,
      source: "demo-json",
    };
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
  };
}

export function setContentRepositoryForTests(
  repository: ContentRepository | undefined,
) {
  contentRepositoryOverride = repository;
}

export function resetReviewQueueForTests() {
  resetDemoReviewQueueForTests();
}

function buildAdminQuestionSections(
  questions: AdminQuestionDashboard["questions"],
): AdminQuestionDashboard["sections"] {
  return {
    approved_student_facing: questions
      .filter(isPublishedContent)
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
  };
}

function safeTopicOptions(topics: AdminQuestionDashboard["topics"]) {
  return topics.map((topic) => ({
    id: topic.id,
    title: topic.title,
  }));
}

async function readWithConfiguredRepository<T>(
  read: (repository: ContentRepository) => Promise<T>,
) {
  if (contentRepositoryOverride) {
    return read(contentRepositoryOverride);
  }

  const env = getServerEnv();
  const policy = getOperatingModePolicy();

  if (policy.repositorySource === "demo") {
    return read(demoContentRepository);
  }

  if (!env.DATABASE_URL) {
    throw new DataServiceUnavailableError("content");
  }

  try {
    return await read(
      createDatabaseContentRepository(env.DATABASE_URL, queryPostgres),
    );
  } catch (cause) {
    if (policy.allowDemoFallback) {
      return read(demoContentRepository);
    }

    throw new DataServiceUnavailableError("content", { cause });
  }
}

async function writeWithConfiguredRepository<T>(
  write: (repository: ContentRepository) => Promise<T>,
) {
  if (contentRepositoryOverride) {
    return write(contentRepositoryOverride);
  }

  const env = getServerEnv();
  const policy = getOperatingModePolicy();

  if (policy.repositorySource === "demo") {
    return write(demoContentRepository);
  }

  if (!env.DATABASE_URL) {
    throw new DataServiceUnavailableError("content");
  }

  try {
    return await write(
      createDatabaseContentRepository(env.DATABASE_URL, queryPostgres),
    );
  } catch (cause) {
    throw new DataServiceUnavailableError("content", { cause });
  }
}

async function writeStrictDatabase<T>(
  write: (repository: ContentRepository) => Promise<T>,
) {
  const env = getServerEnv();

  if (env.APP_DEMO_MODE || !env.DATABASE_URL) {
    throw new DataServiceUnavailableError("content");
  }

  try {
    return await write(
      createDatabaseContentRepository(env.DATABASE_URL, queryPostgres),
    );
  } catch (cause) {
    throw new DataServiceUnavailableError("content", { cause });
  }
}

async function demoAdminQuestionDashboard(
  authorization: ProfessorReviewAuthorization,
  filters: AdminQuestionFilters | undefined,
  topics: AdminQuestionDashboard["topics"],
  fallback = false,
): Promise<AdminQuestionDashboard> {
  const questions = await demoContentRepository.getAdminQuestions(
    authorization,
    filters,
  );

  return {
    mode: "demo",
    questions,
    readOnly: true,
    readOnlyReason: fallback
      ? "The local database is unavailable, so the documented read-only demo fallback is active."
      : "This operating mode uses read-only demo content.",
    sections: buildAdminQuestionSections(questions),
    topics: safeTopicOptions(topics),
  };
}

export {
  isPublishedContent as isStudentFacingQuestion,
  isStudentSafeRetrievalContent as isStudentFacingRetrievalChunk,
};
