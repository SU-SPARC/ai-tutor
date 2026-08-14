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
  ContentAvailabilityNotFoundError,
  ContentAvailabilityValidationError,
  createDatabaseContentAvailabilityRepository,
  type ContentAvailabilityUpdateInput,
} from "@/lib/data/content-availability-repository";
import {
  createDatabaseQuestionLifecycleRepository,
  type CreateQuestionInput,
  type CreateQuestionRevisionInput,
  type CreateQuestionVersionInput,
  type QuestionLifecycleBatchTransitionInput,
  type QuestionLifecycleFilters,
  type QuestionLifecycleTransitionInput,
  type RecordQuestionVersionInspectionInput,
  type RegenerateQuestionVersionInput,
} from "@/lib/data/question-lifecycle-repository";
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
import type {
  AdminQuestion,
  AdminQuestionDashboard,
  ProfessorQuestionReviewCandidateDto,
  ProfessorQuestionReviewDashboard,
  ProfessorReviewTopicSummaryDto,
  QuestionLifecycleDashboard,
  QuestionLifecycleDto,
  QuestionVersionDto,
  ReviewCandidate,
  StudentContentAvailabilityDashboard,
} from "@/lib/types";
import { getServerEnv } from "@/lib/env/server";
import { getOperatingModePolicy } from "@/lib/runtime/operating-mode";
import { buildProfessorTopicReviewProgress } from "@/lib/tutor/professor-review-mode";
import type {
  ContentTransferDocument,
  ContentTransferImportResult,
  ContentTransferStorageInspection,
} from "@/lib/content-transfer/types";

let contentRepositoryOverride: ContentRepository | undefined;
let contentAvailabilityRepositoryOverride:
  | ReturnType<typeof createDatabaseContentAvailabilityRepository>
  | undefined;

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

  return writeStrictDatabaseLifecycle(async (repository) => {
    const current = await repository.getQuestion(
      authorization,
      input.questionId,
    );
    if (!current) {
      return undefined;
    }
    const base = current.workingVersion;
    const updated = await repository.regenerate(authorization, {
      baseVersionId: base.versionId,
      expectedWorkingVersionId: base.versionId,
      idempotencyKey: input.idempotencyKey,
      keepPattern: input.keepPattern,
      questionId: input.questionId,
      requestId: input.requestId,
      supersedeReason: input.supersedeReason,
    });
    if (!updated) {
      return undefined;
    }
    return {
      mode: "deterministic" as const,
      original: lifecycleVersionToAdminQuestion(base),
      preservedOriginal: true,
      regenerated: lifecycleVersionToAdminQuestion(updated.workingVersion),
    };
  });
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

export async function listQuestionLifecycles(
  authorization: ProfessorReviewAuthorization,
  filters?: QuestionLifecycleFilters,
) {
  assertAuthorization(authorization, "professor");
  return writeStrictDatabaseLifecycle((repository) =>
    repository.listQuestions(authorization, filters),
  );
}

export async function getQuestionLifecycleDashboard(
  authorization: ProfessorReviewAuthorization,
): Promise<QuestionLifecycleDashboard> {
  assertAuthorization(authorization, "professor");
  const policy = getOperatingModePolicy();
  if (policy.repositorySource === "demo") {
    const dashboard = await getAdminQuestionDashboard(authorization);
    return {
      mode: "demo",
      questions: dashboard.questions.map((question, index) =>
        demoQuestionLifecycle(question, index + 1),
      ),
      readOnly: true,
      readOnlyReason: "Demo lifecycle data is intentionally read-only.",
      inspections: [],
      topics: dashboard.topics,
    };
  }

  const [questions, topics, inspections] = await Promise.all([
    listQuestionLifecycles(authorization),
    listTopics(),
    listQuestionLifecycleInspections(authorization),
  ]);
  return {
    inspections,
    mode: "database",
    questions,
    readOnly: false,
    topics: safeTopicOptions(topics),
  };
}

export async function getContentAvailabilityDashboard(
  authorization: ProfessorReviewAuthorization,
): Promise<StudentContentAvailabilityDashboard> {
  assertAuthorization(authorization, "professor");
  if (contentAvailabilityRepositoryOverride) {
    return contentAvailabilityRepositoryOverride.getDashboard(authorization);
  }

  const policy = getOperatingModePolicy();
  if (policy.repositorySource === "demo") {
    return demoContentAvailabilityDashboard();
  }

  const env = getServerEnv();
  if (!env.DATABASE_URL) {
    if (policy.allowDemoFallback) return demoContentAvailabilityDashboard();
    throw new DataServiceUnavailableError("content");
  }

  try {
    return await createDatabaseContentAvailabilityRepository(
      queryPostgres,
    ).getDashboard(authorization);
  } catch (cause) {
    if (policy.allowDemoFallback) return demoContentAvailabilityDashboard();
    throw new DataServiceUnavailableError("content", { cause });
  }
}

export async function updateContentAvailability(
  authorization: ProfessorReviewAuthorization,
  input: ContentAvailabilityUpdateInput,
) {
  assertAuthorization(authorization, "professor");
  if (contentAvailabilityRepositoryOverride) {
    return contentAvailabilityRepositoryOverride.updateAvailability(
      authorization,
      input,
    );
  }

  const env = getServerEnv();
  if (env.APP_DEMO_MODE || !env.DATABASE_URL) {
    throw new DataServiceUnavailableError("content");
  }

  try {
    return await createDatabaseContentAvailabilityRepository(
      queryPostgres,
    ).updateAvailability(authorization, input);
  } catch (cause) {
    if (
      cause instanceof ContentAvailabilityNotFoundError ||
      cause instanceof ContentAvailabilityValidationError
    ) {
      throw cause;
    }
    throw new DataServiceUnavailableError("content", { cause });
  }
}

export async function getProfessorQuestionReviewDashboard(
  authorization: ProfessorReviewAuthorization,
  selectedTopicId?: string,
): Promise<ProfessorQuestionReviewDashboard> {
  assertAuthorization(authorization, "professor");
  const policy = getOperatingModePolicy();

  if (contentRepositoryOverride) {
    return legacyProfessorReviewDashboard(
      contentRepositoryOverride,
      authorization,
      selectedTopicId,
      true,
      "The injected review repository does not support lifecycle mutations.",
    );
  }

  if (policy.repositorySource === "demo") {
    return legacyProfessorReviewDashboard(
      demoContentRepository,
      authorization,
      selectedTopicId,
      true,
      "This operating mode uses read-only demo content.",
    );
  }

  const env = getServerEnv();
  if (!env.DATABASE_URL) {
    throw new DataServiceUnavailableError("content");
  }

  try {
    const repository = createDatabaseQuestionLifecycleRepository(queryPostgres);
    const [topics, candidates] = await Promise.all([
      repository.listReviewTopicSummaries(authorization),
      selectedTopicId
        ? repository.listReviewCandidates(authorization, selectedTopicId)
        : Promise.resolve([]),
    ]);
    return {
      candidates,
      mode: "database",
      readOnly: false,
      selectedTopicId,
      topics,
    };
  } catch (cause) {
    if (policy.allowDemoFallback) {
      return legacyProfessorReviewDashboard(
        demoContentRepository,
        authorization,
        selectedTopicId,
        true,
        "The local database is unavailable, so the documented read-only demo fallback is active.",
      );
    }
    throw new DataServiceUnavailableError("content", { cause });
  }
}

export async function getQuestionLifecycle(
  authorization: ProfessorReviewAuthorization,
  questionId: string,
) {
  assertAuthorization(authorization, "professor");
  return writeStrictDatabaseLifecycle((repository) =>
    repository.getQuestion(authorization, questionId),
  );
}

export async function createQuestionLifecycle(
  authorization: ProfessorReviewAuthorization,
  input: CreateQuestionInput,
) {
  assertAuthorization(authorization, "professor");
  return writeStrictDatabaseLifecycle((repository) =>
    repository.createQuestion(authorization, input),
  );
}

export async function inspectContentTransferStorage(
  authorization: ProfessorReviewAuthorization,
  input: {
    contentFingerprints: string[];
    misconceptionIds: string[];
    questionIds: string[];
    topicIds: string[];
  },
): Promise<ContentTransferStorageInspection> {
  assertAuthorization(authorization, "professor");
  return writeStrictDatabaseLifecycle((repository) =>
    repository.inspectContentTransferStorage(authorization, input),
  );
}

export async function importContentTransferDocument(
  authorization: ProfessorReviewAuthorization,
  input: { document: ContentTransferDocument; requestId: string },
): Promise<ContentTransferImportResult> {
  assertAuthorization(authorization, "professor");
  return writeStrictDatabaseLifecycle((repository) =>
    repository.importContentTransfer(authorization, input),
  );
}

export async function createQuestionLifecycleVersion(
  authorization: ProfessorReviewAuthorization,
  input: CreateQuestionVersionInput,
) {
  assertAuthorization(authorization, "professor");
  return writeStrictDatabaseLifecycle((repository) =>
    repository.createVersion(authorization, input),
  );
}

export async function createQuestionLifecycleRevision(
  authorization: ProfessorReviewAuthorization,
  input: CreateQuestionRevisionInput,
) {
  assertAuthorization(authorization, "professor");
  return writeStrictDatabaseLifecycle((repository) =>
    repository.createRevision(authorization, input),
  );
}

export async function transitionQuestionLifecycle(
  authorization: ProfessorReviewAuthorization,
  input: QuestionLifecycleTransitionInput,
) {
  assertAuthorization(authorization, "professor");
  return writeStrictDatabaseLifecycle((repository) =>
    repository.transition(authorization, input),
  );
}

export async function recordQuestionVersionInspection(
  authorization: ProfessorReviewAuthorization,
  input: RecordQuestionVersionInspectionInput,
) {
  assertAuthorization(authorization, "professor");
  return writeStrictDatabaseLifecycle((repository) =>
    repository.recordInspection(authorization, input),
  );
}

async function listQuestionLifecycleInspections(
  authorization: ProfessorReviewAuthorization,
) {
  assertAuthorization(authorization, "professor");
  return writeStrictDatabaseLifecycle((repository) =>
    repository.listInspections(authorization),
  );
}

export async function batchTransitionQuestionLifecycle(
  authorization: ProfessorReviewAuthorization,
  input: QuestionLifecycleBatchTransitionInput,
) {
  assertAuthorization(authorization, "professor");
  return writeStrictDatabaseLifecycle((repository) =>
    repository.batchTransition(authorization, input),
  );
}

export async function regenerateQuestionLifecycleVersion(
  authorization: ProfessorReviewAuthorization,
  input: RegenerateQuestionVersionInput,
) {
  assertAuthorization(authorization, "professor");
  return writeStrictDatabaseLifecycle((repository) =>
    repository.regenerate(authorization, input),
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

export function setContentAvailabilityRepositoryForTests(
  repository:
    | ReturnType<typeof createDatabaseContentAvailabilityRepository>
    | undefined,
) {
  contentAvailabilityRepositoryOverride = repository;
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

async function demoContentAvailabilityDashboard(): Promise<StudentContentAvailabilityDashboard> {
  const [topics, questions] = await Promise.all([listTopics(), listQuestions()]);

  return {
    assignmentScope: "global_only",
    auditEvents: [],
    mode: "demo",
    questions: questions.map((question) => ({
      audienceType: "global",
      effectiveAvailability: "available",
      id: question.id,
      publicationState: "published",
      releaseState: "published",
      targetType: "question",
      title: question.title,
      topicId: question.topicId,
      topicTitle:
        topics.find((topic) => topic.id === question.topicId)?.title ??
        question.topicId,
    })),
    readOnly: true,
    readOnlyReason:
      "Availability controls require the production database; demo content remains read-only.",
    topics: topics.map((topic) => ({
      audienceType: "global",
      effectiveAvailability: "available",
      id: topic.id,
      publicationState: "published",
      releaseState: "published",
      targetType: "topic",
      title: topic.title,
    })),
  };
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

async function writeStrictDatabaseLifecycle<T>(
  write: (
    repository: ReturnType<typeof createDatabaseQuestionLifecycleRepository>,
  ) => Promise<T>,
) {
  const env = getServerEnv();

  if (env.APP_DEMO_MODE || !env.DATABASE_URL) {
    throw new DataServiceUnavailableError("content");
  }

  try {
    return await write(
      createDatabaseQuestionLifecycleRepository(queryPostgres),
    );
  } catch (cause) {
    if (
      cause instanceof Error &&
      (cause.name === "QuestionLifecycleConflictError" ||
        cause.name === "QuestionLifecycleNotFoundError" ||
        cause.name === "QuestionLifecycleValidationError")
    ) {
      throw cause;
    }
    throw new DataServiceUnavailableError("content", { cause });
  }
}

function lifecycleVersionToAdminQuestion(
  version: import("@/lib/types").QuestionVersionDto,
): import("@/lib/types").AdminQuestion {
  return {
    answer: {
      ...version.answer,
      acceptedAnswers: [...version.answer.acceptedAnswers],
    },
    difficulty: version.difficulty,
    hints: [...version.hints],
    id: version.id,
    misconceptions: version.misconceptions.map((misconception) => ({
      ...misconception,
      matchTerms: [...misconception.matchTerms],
    })),
    patternSource: version.source.patternIds?.[0] ?? version.source.sourceType,
    prompt: version.prompt,
    review: {
      status:
        version.state === "rejected"
          ? "rejected"
          : version.state === "approved" || version.state === "published"
            ? "approved"
            : version.state === "revision_requested"
              ? "needs_edit"
              : "needs_review",
    },
    solutionSteps: [...version.solutionSteps],
    source: { ...version.source },
    title: version.title,
    topicId: version.topicId,
  };
}

function demoQuestionLifecycle(
  question: AdminQuestion,
  versionId: number,
): QuestionLifecycleDto {
  const state = isPublishedContent(question)
    ? "published"
    : question.review.status === "rejected"
      ? "rejected"
      : question.review.status === "needs_edit" ||
          question.review.status === "needs_regeneration"
        ? "revision_requested"
        : "needs_review";
  const occurredAt = question.review.reviewedAt ?? new Date(0).toISOString();
  const version: QuestionVersionDto = {
    allowedActions: [],
    answer: {
      ...question.answer,
      acceptedAnswers: [...question.answer.acceptedAnswers],
    },
    contentHash: `demo-${question.id}`,
    createdAt: occurredAt,
    createdBy: {
      displayName: question.review.reviewedBy ?? "Demo fixture",
      occurredAt,
      userId: "system:demo-fixture",
    },
    creationMethod:
      question.source.sourceType === "generated_original" ||
      question.source.sourceType === "pattern_derived_original"
        ? "generated"
        : "imported",
    difficulty: question.difficulty,
    hints: [...question.hints],
    generationMetadata: {},
    id: question.id,
    misconceptions: question.misconceptions.map((misconception) => ({
      ...misconception,
      matchTerms: [...misconception.matchTerms],
    })),
    prompt: question.prompt,
    schemaVersion: 1,
    solutionSteps: [...question.solutionSteps],
    source: { ...question.source },
    state,
    title: question.title,
    topicId: question.topicId,
    validationStatus: "valid",
    versionId,
    versionNumber: 1,
  };
  return {
    allowedActions: [],
    events: [],
    publishedVersion: state === "published" ? version : undefined,
    questionId: question.id,
    recordState: "active",
    regenerationAllowed: false,
    versions: [version],
    workingVersion: version,
  };
}

async function legacyProfessorReviewDashboard(
  repository: ContentRepository,
  authorization: ProfessorReviewAuthorization,
  selectedTopicId: string | undefined,
  readOnly: boolean,
  readOnlyReason?: string,
): Promise<ProfessorQuestionReviewDashboard> {
  const [topics, questions] = await Promise.all([
    repository.listTopics(),
    repository.getAdminQuestions(authorization),
  ]);
  const activeTopics = topics
    .filter((topic) => topic.active)
    .sort(
      (left, right) =>
        left.order - right.order ||
        left.title.localeCompare(right.title) ||
        left.id.localeCompare(right.id),
    );
  const topicSummaries = activeTopics.map((topic) =>
    legacyProfessorReviewTopicSummary(
      topic.id,
      topic.title,
      topic.order,
      questions.filter((question) => question.topicId === topic.id),
    ),
  );
  const candidates = selectedTopicId
    ? questions
        .filter(
          (question) =>
            question.topicId === selectedTopicId &&
            question.review.status === "needs_review",
        )
        .sort(
          (left, right) =>
            Number((right.review.reviewPriority ?? "normal") === "priority") -
              Number((left.review.reviewPriority ?? "normal") === "priority") ||
            left.title.localeCompare(right.title) ||
            left.id.localeCompare(right.id),
        )
        .map((question, index) =>
          legacyProfessorReviewCandidate(question, index + 1, readOnly),
        )
    : [];

  return {
    candidates,
    mode: "demo",
    readOnly,
    readOnlyReason,
    selectedTopicId,
    topics: topicSummaries,
  };
}

function legacyProfessorReviewTopicSummary(
  topicId: string,
  title: string,
  order: number,
  questions: AdminQuestion[],
): ProfessorReviewTopicSummaryDto {
  const count = (statuses: AdminQuestion["review"]["status"][]) =>
    questions.filter((question) => statuses.includes(question.review.status))
      .length;

  return {
    approved: count(["approved"]),
    needsReview: count(["needs_review"]),
    order,
    rejectedOrRevisionRequested: count([
      "rejected",
      "needs_edit",
      "needs_regeneration",
    ]),
    remaining: count(["needs_review", "needs_edit", "needs_regeneration"]),
    title,
    topicId,
    total: questions.length,
  };
}

function legacyProfessorReviewCandidate(
  question: AdminQuestion,
  versionId: number,
  readOnly: boolean,
): ProfessorQuestionReviewCandidateDto {
  const occurredAt = question.review.reviewedAt ?? new Date(0).toISOString();
  return {
    allowedActions: readOnly ? [] : ["request_revision", "approve", "reject"],
    answer: {
      ...question.answer,
      acceptedAnswers: [...question.answer.acceptedAnswers],
    },
    createdAt: occurredAt,
    createdBy: {
      displayName: question.review.reviewedBy ?? "Demo fixture",
      occurredAt,
    },
    creationMethod:
      question.source.sourceType === "generated_original" ||
      question.source.sourceType === "pattern_derived_original"
        ? "generated"
        : "imported",
    difficulty: question.difficulty,
    hints: [...question.hints],
    id: question.id,
    misconceptions: question.misconceptions.map(({ feedback, id }) => ({
      feedback,
      id,
    })),
    prompt: question.prompt,
    questionId: question.id,
    review: {
      reviewPriority: question.review.reviewPriority ?? "normal",
      status: "needs_review",
    },
    solutionSteps: [...question.solutionSteps],
    source: {
      originalityNote: question.source.originalityNote,
      sourceType: question.source.sourceType,
      trustLevel: question.source.trustLevel,
    },
    state: "needs_review",
    title: question.title,
    topicId: question.topicId,
    validationStatus: "valid",
    versionId,
    versionNumber: 1,
  };
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
