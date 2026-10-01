import "server-only";

import {
  assertAuthorization,
  isPublishedContent,
  isRetrievalEligibleContent,
  isStudentSafeRetrievalContent,
  type AnalyticsAuthorization,
  type ProfessorAuthorization,
  type ProfessorReviewAuthorization,
} from "@/lib/auth/authorization";
import type { StudentOwner } from "@/lib/auth/principal";
import type { CoursesAction } from "@/lib/courses/reducer";
import type { CoursesState } from "@/lib/courses/types";
import { createDatabaseContentRepository } from "@/lib/data/database-repository";
import {
  ContentAvailabilityNotFoundError,
  ContentAvailabilityValidationError,
  createDatabaseContentAvailabilityRepository,
  type ContentAvailabilityUpdateInput,
} from "@/lib/data/content-availability-repository";
import {
  createDatabaseQuestionLifecycleRepository,
  type ApproveQuestionReviewInput,
  type CreateQuestionInput,
  type CreateQuestionRevisionInput,
  type CorrectQuestionVersionProvenanceInput,
  type CreateQuestionVersionInput,
  type QuestionLifecycleBatchTransitionInput,
  type QuestionLifecycleBatchPreviewInput,
  type QuestionLifecycleFilters,
  type QuestionLifecycleTransitionInput,
  type RecordQuestionVersionInspectionInput,
  type RegenerateQuestionVersionInput,
  type SetQuestionReserveInput,
} from "@/lib/data/question-lifecycle-repository";
import {
  demoContentRepository,
  resetDemoReviewQueueForTests,
} from "@/lib/data/demo-repository";
import {
  CoursesConflictError,
  CoursesNotFoundError,
  CoursesValidationError,
  createDatabaseCoursesRepository,
  createDemoCoursesRepository,
  readStudentQuestionVersion,
  type CoursesRepository,
  type SectionReleaseDto,
  type StudentSectionDto,
} from "@/lib/data/courses-repository";
import {
  createDatabaseInstructorStudentRepository,
  INSTRUCTOR_STUDENT_PAGE_SIZE,
} from "@/lib/data/instructor-student-repository";
import { createDatabasePilotAnalyticsExportRepository } from "@/lib/data/pilot-analytics-export-repository";
import {
  createDatabaseStudentIdentityRepository,
  recordStudentIdentityView,
  recordStudentIdentityViews,
  type StudentAccountLink,
} from "@/lib/data/student-identity-repository";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
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
  InstructorCohortAnalytics,
  InstructorIdentityViewScope,
  InstructorStudentDetail,
  InstructorStudentList,
  InstructorStudentListFilters,
  InstructorStudentTopicRoster,
  ProfessorQuestionReviewCandidateDto,
  ProfessorQuestionReviewDashboard,
  ProfessorReviewTopicSummaryDto,
  QuestionLifecycleDashboard,
  QuestionLifecycleDto,
  QuestionVersionDto,
  PracticeQuestion,
  ReviewCandidate,
  StudentContentAvailabilityDashboard,
} from "@/lib/types";
import { getServerEnv } from "@/lib/env/server";
import { getOperatingModePolicy } from "@/lib/runtime/operating-mode";
import { buildProfessorTopicReviewProgress } from "@/lib/tutor/professor-review-mode";
import { isQuestionLifecycleDomainError } from "@/lib/tutor/question-lifecycle";
import type {
  ContentTransferDocument,
  ContentTransferImportResult,
  ContentTransferStorageInspection,
} from "@/lib/content-transfer/types";
import type {
  QuestionIntakeDuplicate,
  QuestionIntakeTopic,
} from "@/lib/question-intake/types";
import {
  emptyPilotAnalyticsExport,
  type PilotAnalyticsExport,
} from "@/lib/analytics/pilot-export";

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
      professorUserId: authorization.principal.userId,
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
    professorUserId: authorization.principal.userId,
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

/**
 * Demo mode keeps tutor sessions in an in-process store that is only readable
 * per owner, so there is no cohort to enumerate. Report that honestly rather
 * than inventing synthetic students an instructor might mistake for real ones.
 */
function demoInstructorStudentList(
  filters: InstructorStudentListFilters,
): InstructorStudentList {
  return {
    limit: filters.limit ?? INSTRUCTOR_STUDENT_PAGE_SIZE,
    mode: "demo",
    offset: filters.offset ?? 0,
    students: [],
    total: 0,
  };
}

function demoInstructorStudentTopicRoster(): InstructorStudentTopicRoster {
  return { mode: "demo", revealed: false, topics: [], unassigned: [] };
}

function demoInstructorCohortAnalytics(): InstructorCohortAnalytics {
  return {
    activeStudents: 0,
    attempts: 0,
    blockedAttempts: 0,
    correctAttempts: 0,
    excludedStaffSessions: 0,
    extraPracticeSessions: 0,
    hintsUsed: 0,
    llmAttempts: 0,
    misconceptions: [],
    mode: "demo",
    retrievalAttempts: 0,
    ruleAttempts: 0,
    sessions: 0,
    solutionsRevealed: 0,
    studentsNeedingAttention: 0,
  };
}

function instructorStudentRepository() {
  const policy = getOperatingModePolicy();

  if (policy.repositorySource === "demo") {
    return undefined;
  }

  const env = getServerEnv();

  if (!env.DATABASE_URL) {
    return undefined;
  }

  return createDatabaseInstructorStudentRepository(queryPostgres);
}

export async function listInstructorStudents(
  authorization: AnalyticsAuthorization,
  filters: InstructorStudentListFilters = {},
): Promise<InstructorStudentList> {
  assertAuthorization(authorization, "professor");
  const repository = instructorStudentRepository();

  if (!repository) {
    return demoInstructorStudentList(filters);
  }

  try {
    return await repository.listStudents(authorization, filters);
  } catch (cause) {
    if (getOperatingModePolicy().allowDemoFallback) {
      return demoInstructorStudentList(filters);
    }

    throw new DataServiceUnavailableError("tutor-session", { cause });
  }
}

/**
 * The Students page grouped by practised topic, pseudonymous like the list.
 * Demo mode has no cohort to group, so it reports an empty roster in demo
 * mode rather than an error.
 */
export async function listInstructorStudentTopicRoster(
  authorization: AnalyticsAuthorization,
): Promise<InstructorStudentTopicRoster> {
  assertAuthorization(authorization, "professor");
  const repository = instructorStudentRepository();

  if (!repository) {
    return demoInstructorStudentTopicRoster();
  }

  try {
    return await repository.listTopicRoster(authorization);
  } catch (cause) {
    if (getOperatingModePolicy().allowDemoFallback) {
      return demoInstructorStudentTopicRoster();
    }

    throw new DataServiceUnavailableError("tutor-session", { cause });
  }
}

export async function getInstructorStudentDetail(
  authorization: AnalyticsAuthorization,
  studentKey: string,
): Promise<InstructorStudentDetail | undefined> {
  assertAuthorization(authorization, "professor");
  const repository = instructorStudentRepository();

  if (!repository) {
    return undefined;
  }

  try {
    return await repository.getStudentDetail(authorization, studentKey);
  } catch (cause) {
    if (getOperatingModePolicy().allowDemoFallback) {
      return undefined;
    }

    throw new DataServiceUnavailableError("tutor-session", { cause });
  }
}

/**
 * Resolves which account a pseudonym belongs to, for the explicit identity
 * reveal only. Demo mode has no shared cohort to resolve against, so it
 * reports nothing rather than an empty identity.
 */
export async function findInstructorStudentAccountLink(
  authorization: AnalyticsAuthorization,
  studentKey: string,
): Promise<StudentAccountLink | undefined> {
  assertAuthorization(authorization, "professor");
  const policy = getOperatingModePolicy();

  if (policy.repositorySource === "demo" || !getServerEnv().DATABASE_URL) {
    return undefined;
  }

  try {
    return await createDatabaseStudentIdentityRepository(
      queryPostgres,
    ).findAccountLink(authorization, studentKey);
  } catch (cause) {
    if (getOperatingModePolicy().allowDemoFallback) {
      return undefined;
    }

    throw new DataServiceUnavailableError("tutor-session", { cause });
  }
}

/**
 * The Students page's account links, resolved in one read. Demo mode has no
 * cohort, so it resolves nothing, which is reported per student.
 */
export async function findInstructorStudentAccountLinks(
  authorization: AnalyticsAuthorization,
  studentKeys: string[],
): Promise<Map<string, StudentAccountLink>> {
  assertAuthorization(authorization, "professor");
  const policy = getOperatingModePolicy();

  if (policy.repositorySource === "demo" || !getServerEnv().DATABASE_URL) {
    return new Map();
  }

  try {
    return await createDatabaseStudentIdentityRepository(
      queryPostgres,
    ).findAccountLinks(authorization, studentKeys);
  } catch (cause) {
    if (getOperatingModePolicy().allowDemoFallback) {
      return new Map();
    }

    throw new DataServiceUnavailableError("tutor-session", { cause });
  }
}

/**
 * Rejects rather than returning quietly when there is nowhere to write. A
 * reveal that cannot be recorded must not be served, so "no audit store" is a
 * failure here and not a permitted no-op. Demo mode never reaches this: it
 * resolves no account link to reveal in the first place.
 */
export async function recordInstructorStudentIdentityView(
  authorization: AnalyticsAuthorization,
  input: { requestId?: string; status: string; studentKey: string },
) {
  assertAuthorization(authorization, "professor");
  const policy = getOperatingModePolicy();

  if (policy.repositorySource === "demo" || !getServerEnv().DATABASE_URL) {
    throw new DataServiceUnavailableError("tutor-session");
  }

  await recordStudentIdentityView(queryPostgres, {
    ...input,
    professorUserId: authorization.principal.userId,
  });
}

/**
 * The Students page's audit write, with the same rule as the single reveal:
 * nowhere to write is a failure, never a permitted no-op.
 */
export async function recordInstructorStudentIdentityViews(
  authorization: AnalyticsAuthorization,
  input: {
    requestId?: string;
    scope: InstructorIdentityViewScope;
    views: Array<{ status: string; studentKey: string }>;
  },
) {
  assertAuthorization(authorization, "professor");
  const policy = getOperatingModePolicy();

  if (policy.repositorySource === "demo" || !getServerEnv().DATABASE_URL) {
    throw new DataServiceUnavailableError("tutor-session");
  }

  await recordStudentIdentityViews(queryPostgres, {
    ...input,
    professorUserId: authorization.principal.userId,
  });
}

export async function getInstructorCohortAnalytics(
  authorization: AnalyticsAuthorization,
): Promise<InstructorCohortAnalytics> {
  assertAuthorization(authorization, "professor");
  const repository = instructorStudentRepository();

  if (!repository) {
    return demoInstructorCohortAnalytics();
  }

  try {
    return await repository.getCohortAnalytics(authorization);
  } catch (cause) {
    if (getOperatingModePolicy().allowDemoFallback) {
      return demoInstructorCohortAnalytics();
    }

    throw new DataServiceUnavailableError("tutor-session", { cause });
  }
}

function pilotAnalyticsExportRepository() {
  const policy = getOperatingModePolicy();

  if (policy.repositorySource === "demo") {
    return undefined;
  }

  const env = getServerEnv();
  if (!env.DATABASE_URL) {
    return undefined;
  }

  return createDatabasePilotAnalyticsExportRepository(queryPostgres);
}

export async function getPilotAnalyticsExport(
  authorization: AnalyticsAuthorization,
): Promise<PilotAnalyticsExport> {
  assertAuthorization(authorization, "professor");
  const repository = pilotAnalyticsExportRepository();

  if (!repository) {
    return emptyPilotAnalyticsExport();
  }

  try {
    return await repository.build(authorization);
  } catch (cause) {
    if (getOperatingModePolicy().allowDemoFallback) {
      return emptyPilotAnalyticsExport();
    }

    throw new DataServiceUnavailableError("tutor-session", { cause });
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

export async function getQuestionIntakeTopics(
  authorization: ProfessorReviewAuthorization,
): Promise<QuestionIntakeTopic[]> {
  assertAuthorization(authorization, "professor");
  const policy = getOperatingModePolicy();
  if (contentRepositoryOverride || policy.repositorySource === "demo") {
    const topics = await listTopics();
    return topics
      .filter((topic) => topic.active)
      .map(({ description, id, title }) => ({ description, id, title }));
  }
  return writeStrictDatabaseLifecycle((repository) =>
    repository.listQuestionIntakeTopics(authorization),
  );
}

export async function findQuestionIntakeDuplicates(
  authorization: ProfessorReviewAuthorization,
  input: { prompt: string; topicId: string },
): Promise<QuestionIntakeDuplicate[]> {
  assertAuthorization(authorization, "professor");
  const policy = getOperatingModePolicy();
  if (contentRepositoryOverride || policy.repositorySource === "demo") {
    return [];
  }
  return writeStrictDatabaseLifecycle((repository) =>
    repository.findQuestionIntakeDuplicates(authorization, input),
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

export async function correctQuestionLifecycleProvenance(
  authorization: ProfessorReviewAuthorization,
  input: CorrectQuestionVersionProvenanceInput,
) {
  assertAuthorization(authorization, "professor");
  return writeStrictDatabaseLifecycle((repository) =>
    repository.correctProvenance(authorization, input),
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

export async function approveQuestionReview(
  authorization: ProfessorReviewAuthorization,
  input: ApproveQuestionReviewInput,
) {
  assertAuthorization(authorization, "professor");
  return writeStrictDatabaseLifecycle((repository) =>
    repository.approveReviewCandidate(authorization, input),
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

export async function setQuestionReserveDisposition(
  authorization: ProfessorReviewAuthorization,
  input: SetQuestionReserveInput,
) {
  assertAuthorization(authorization, "professor");
  return writeStrictDatabaseLifecycle((repository) =>
    repository.setReserveDisposition(authorization, input),
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

export async function previewBatchQuestionLifecycle(
  authorization: ProfessorReviewAuthorization,
  input: QuestionLifecycleBatchPreviewInput,
) {
  assertAuthorization(authorization, "professor");
  return writeStrictDatabaseLifecycle((repository) =>
    repository.previewBatchTransition(authorization, input),
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

/*
 * Courses, sections, rosters and per-section releases (migration 029).
 *
 * Demo modes use a process-memory repository seeded from the courses demo seed
 * (so the ghost professor's screens and "Reset demo data" keep working); every
 * other mode reads and writes Postgres. Domain errors (not found, validation,
 * conflict) pass through so the API can map them to 404/400/409; anything else
 * is a data-service outage. Writes never fall back to the demo store, and
 * reads only do where the operating mode allows a demo fallback.
 */
let coursesRepositoryOverride: CoursesRepository | undefined;

// `next dev` gives route handlers and server components separate module
// instances, so a module-level singleton would give a student's join (made
// through the API) and the Learn page (a server component) different demo
// stores. Keep it on globalThis, as postgres.ts does for its pool.
type DemoCoursesGlobal = typeof globalThis & {
  __aiTutorDemoCoursesRepository?: CoursesRepository;
};
const demoCoursesGlobal = globalThis as DemoCoursesGlobal;

function sharedDemoCoursesRepository() {
  demoCoursesGlobal.__aiTutorDemoCoursesRepository ??=
    createDemoCoursesRepository();
  return demoCoursesGlobal.__aiTutorDemoCoursesRepository;
}

/** True when the courses screens run against the in-memory demo store. */
export function coursesDemoMode(): boolean {
  if (coursesRepositoryOverride) return false;
  return getOperatingModePolicy().repositorySource === "demo";
}

function isCoursesDomainError(cause: unknown) {
  return (
    cause instanceof CoursesNotFoundError ||
    cause instanceof CoursesValidationError ||
    cause instanceof CoursesConflictError
  );
}

async function withCoursesRepository<T>(
  work: (repository: CoursesRepository) => Promise<T>,
  options: { allowFallback: boolean },
): Promise<T> {
  if (coursesRepositoryOverride) {
    return work(coursesRepositoryOverride);
  }

  const policy = getOperatingModePolicy();
  if (policy.repositorySource === "demo") {
    return work(sharedDemoCoursesRepository());
  }

  const env = getServerEnv();
  if (!env.DATABASE_URL) {
    if (options.allowFallback && policy.allowDemoFallback) {
      return work(sharedDemoCoursesRepository());
    }
    throw new DataServiceUnavailableError("content");
  }

  try {
    return await work(createDatabaseCoursesRepository(queryPostgres));
  } catch (cause) {
    if (isCoursesDomainError(cause)) {
      throw cause;
    }
    if (options.allowFallback && policy.allowDemoFallback) {
      return work(sharedDemoCoursesRepository());
    }
    throw new DataServiceUnavailableError("content", { cause });
  }
}

export async function getProfessorCoursesState(
  authorization: ProfessorAuthorization,
): Promise<CoursesState> {
  assertAuthorization(authorization, "professor");
  // No demo fallback here: the screens would show seed courses while
  // `coursesDemoMode()` says false and every save fails. "Could not load"
  // is the honest answer when the database is down.
  return withCoursesRepository(
    (repository) =>
      repository.loadProfessorState(authorization.principal.userId),
    { allowFallback: false },
  );
}

export async function applyProfessorCoursesAction(
  authorization: ProfessorAuthorization,
  action: CoursesAction,
  requestId?: string,
): Promise<CoursesState> {
  assertAuthorization(authorization, "professor");
  return withCoursesRepository(
    (repository) =>
      repository.applyProfessorAction(
        authorization.principal.userId,
        action,
        requestId,
      ),
    { allowFallback: false },
  );
}

export async function joinStudentSection(
  owner: StudentOwner,
  joinCode: string,
): Promise<StudentSectionDto> {
  return withCoursesRepository(
    (repository) => repository.joinSection(owner, joinCode),
    { allowFallback: false },
  );
}

export async function leaveStudentSection(owner: StudentOwner): Promise<void> {
  return withCoursesRepository((repository) => repository.leaveSection(owner), {
    allowFallback: false,
  });
}

export async function getStudentSection(
  owner: StudentOwner,
): Promise<StudentSectionDto | undefined> {
  return withCoursesRepository(
    (repository) => repository.getStudentSection(owner),
    { allowFallback: true },
  );
}

export async function getStudentSectionReleases(
  owner: StudentOwner,
): Promise<
  { section: StudentSectionDto; releases: SectionReleaseDto[] } | undefined
> {
  return withCoursesRepository(
    async (repository) => {
      const section = await repository.getStudentSection(owner);
      if (!section) return undefined;
      return {
        section,
        releases: await repository.getSectionReleases(section.sectionId),
      };
    },
    { allowFallback: true },
  );
}

let studentQuestionVersionQueryOverride: DatabaseQueryExecutor | undefined;

/**
 * The content of one question version for a student, only when that version
 * is the student's section pin for the question (see
 * `readStudentQuestionVersion`): a section student sees, and is graded on, the
 * version their section released even after a newer one is published.
 * `undefined` when it is not their pin. Shaped like the published questions
 * (`PracticeQuestion`), so the existing serializers accept it; its `id` is the
 * question id.
 *
 * Demo modes (and test doubles of the courses or content repositories) have
 * no version table: the demo pin is a version number standing in for an id,
 * so the published content is returned. The database read never falls back to
 * the published content; it falls back to the demo store only where the
 * operating mode allows a demo fallback, like the other student reads.
 */
export async function getStudentQuestionVersion(
  owner: StudentOwner,
  questionId: string,
  questionVersionId: number,
): Promise<PracticeQuestion | undefined> {
  if (studentQuestionVersionQueryOverride) {
    return readStudentQuestionVersion(
      studentQuestionVersionQueryOverride,
      owner,
      questionId,
      questionVersionId,
    );
  }

  const policy = getOperatingModePolicy();
  if (
    coursesRepositoryOverride ||
    contentRepositoryOverride ||
    policy.repositorySource === "demo"
  ) {
    return getApprovedQuestionById(questionId);
  }

  const env = getServerEnv();
  if (!env.DATABASE_URL) {
    throw new DataServiceUnavailableError("content");
  }

  try {
    return await readStudentQuestionVersion(
      queryPostgres,
      owner,
      questionId,
      questionVersionId,
    );
  } catch (cause) {
    if (policy.allowDemoFallback) {
      return getApprovedQuestionById(questionId);
    }
    throw new DataServiceUnavailableError("content", { cause });
  }
}

export function setStudentQuestionVersionQueryForTests(
  query: DatabaseQueryExecutor | undefined,
) {
  studentQuestionVersionQueryOverride = query;
}

export function setCoursesRepositoryForTests(
  repository: CoursesRepository | undefined,
) {
  coursesRepositoryOverride = repository;
}

export function resetDemoCoursesRepositoryForTests() {
  demoCoursesGlobal.__aiTutorDemoCoursesRepository = undefined;
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
  const [topics, questions] = await Promise.all([
    listTopics(),
    listQuestions(),
  ]);

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
    if (isQuestionLifecycleDomainError(cause)) {
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
    ...(version.figure ? { figure: structuredClone(version.figure) } : {}),
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
    ...(question.figure ? { figure: structuredClone(question.figure) } : {}),
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
    provenanceCorrectionAllowed: false,
    regenerationAllowed: false,
    reserveEvents: [],
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
    ...(question.figure ? { figure: structuredClone(question.figure) } : {}),
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
