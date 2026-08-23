import "server-only";

import { createHash } from "node:crypto";

import {
  assertAuthorization,
  ownerFromAuthorization,
  reviewerAttribution,
  type ProfessorReviewAuthorization,
  type StudentAuthorization,
} from "@/lib/auth/authorization";
import type { StudentOwner } from "@/lib/auth/principal";
import {
  readDatabaseRows,
  runDatabaseTransaction,
  type DatabaseQueryExecutor,
} from "@/lib/data/database-executor";
import { queryPostgres } from "@/lib/data/postgres";
import { DataServiceUnavailableError } from "@/lib/data/service-error";
import { getTutorSession } from "@/lib/data/tutor-session-repository";
import { getServerEnv } from "@/lib/env/server";
import { getOperatingModePolicy } from "@/lib/runtime/operating-mode";
import {
  QUESTION_FEEDBACK_CATEGORIES,
  QUESTION_FEEDBACK_STATUSES,
  type ProfessorQuestionFeedbackDashboard,
  type ProfessorQuestionFeedbackReport,
  type QuestionFeedbackCategory,
  type QuestionFeedbackReceipt,
  type QuestionFeedbackStatus,
} from "@/lib/types";

const MAX_REPORTS_PER_HOUR = 5;
const MAX_MATCHING_REPORTS_PER_DAY = 2;
const MAX_DETAILS_LENGTH = 1_000;
const MAX_RESOLUTION_NOTES_LENGTH = 1_000;

export const QUESTION_FEEDBACK_ACKNOWLEDGEMENT =
  "Report received. Thank you for flagging it.";

const DEFAULT_MESSAGES: Record<QuestionFeedbackCategory, string> = {
  answer_appears_incorrect: "The answer or explanation appears incorrect.",
  hint_unhelpful: "A hint was not helpful.",
  other: "The student reported another problem with this tutoring item.",
  solution_step_issue: "A solution step appears to have a problem.",
  technical_problem: "A technical problem occurred during this tutor session.",
  wording_unclear: "The question or explanation wording is unclear.",
};

type QuestionFeedbackRow = {
  assigned_to_display_name?: string | null;
  category: string;
  created_at: Date | string;
  id: number | string;
  idempotency_key: string;
  message: string;
  question_id: string;
  question_title?: string | null;
  question_version_id: number | string;
  question_version_number?: number | string | null;
  resolution_notes: string | null;
  resolved_at: Date | string | null;
  status: QuestionFeedbackStatus;
  topic_id?: string | null;
  tutor_session_id: string;
  updated_at: Date | string;
};

type SubmitRepositoryInput = {
  category: QuestionFeedbackCategory;
  idempotencyKey: string;
  message: string;
  owner: StudentOwner;
  questionId: string;
  questionTitle: string;
  questionVersionId: number;
  sessionId: string;
  topicId?: string;
};

type ReviewRepositoryInput = {
  reportId: string;
  resolutionNotes?: string;
  status: QuestionFeedbackStatus;
};

export type QuestionFeedbackRepository = {
  getDashboard(
    authorization: ProfessorReviewAuthorization,
  ): Promise<Omit<ProfessorQuestionFeedbackDashboard, "mode">>;
  reviewReport(
    authorization: ProfessorReviewAuthorization,
    input: ReviewRepositoryInput,
  ): Promise<ProfessorQuestionFeedbackReport | undefined>;
  submit(input: SubmitRepositoryInput): Promise<QuestionFeedbackReceipt>;
};

type MemoryReport = ProfessorQuestionFeedbackReport & {
  idempotencyKey: string;
  reporterSubjectHash: string;
};

export class QuestionFeedbackValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestionFeedbackValidationError";
  }
}

export class QuestionFeedbackNotFoundError extends Error {
  constructor(message = "Tutor session was not found.") {
    super(message);
    this.name = "QuestionFeedbackNotFoundError";
  }
}

export class QuestionFeedbackRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Too many reports were submitted. Please try again later.");
    this.name = "QuestionFeedbackRateLimitError";
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

let memoryQuestionFeedbackRepository = createMemoryQuestionFeedbackRepository();
let questionFeedbackRepositoryOverride: QuestionFeedbackRepository | undefined;

export async function submitQuestionFeedback(
  authorization: StudentAuthorization,
  input: {
    category: QuestionFeedbackCategory;
    details?: string;
    idempotencyKey: string;
    sessionId: string;
  },
) {
  assertAuthorization(authorization, "student");
  const normalized = normalizeStudentInput(input);
  const session = await getTutorSession(authorization, normalized.sessionId);

  if (!session?.questionVersionId) {
    throw new QuestionFeedbackNotFoundError();
  }

  const owner = ownerFromAuthorization(authorization);
  return writeWithConfiguredRepository((repository) =>
    repository.submit({
      category: normalized.category,
      idempotencyKey: normalized.idempotencyKey,
      message: normalized.details ?? DEFAULT_MESSAGES[normalized.category],
      owner,
      questionId: session.questionId,
      questionTitle:
        session.questionVersion?.title ?? session.questionTitle ?? "Question",
      questionVersionId: session.questionVersionId!,
      sessionId: session.id,
      topicId: session.questionVersion?.topicId ?? session.topicId,
    }),
  );
}

export async function getProfessorQuestionFeedbackDashboard(
  authorization: ProfessorReviewAuthorization,
): Promise<ProfessorQuestionFeedbackDashboard> {
  assertAuthorization(authorization, "professor");
  const result = await readWithConfiguredRepository((repository) =>
    repository.getDashboard(authorization),
  );
  return result;
}

export async function reviewQuestionFeedback(
  authorization: ProfessorReviewAuthorization,
  input: ReviewRepositoryInput,
) {
  assertAuthorization(authorization, "professor");
  const normalized = normalizeReviewInput(input);
  const report = await writeWithConfiguredRepository((repository) =>
    repository.reviewReport(authorization, normalized),
  );
  if (!report) {
    throw new QuestionFeedbackNotFoundError("Feedback report was not found.");
  }
  return report;
}

export function createMemoryQuestionFeedbackRepository(): QuestionFeedbackRepository {
  const reports: MemoryReport[] = [];
  let nextId = 1;

  return {
    async getDashboard(authorization) {
      assertAuthorization(authorization, "professor");
      return dashboardFromReports(reports.map(publicReport));
    },

    async reviewReport(authorization, input) {
      assertAuthorization(authorization, "professor");
      const report = reports.find((item) => item.id === input.reportId);
      if (!report) return undefined;

      const reviewer = reviewerAttribution(authorization);
      const now = new Date().toISOString();
      report.status = input.status;
      report.resolutionNotes = input.resolutionNotes;
      report.assignedToDisplayName =
        input.status === "open" ? undefined : reviewer.displayName;
      report.resolvedAt = isTerminalStatus(input.status) ? now : undefined;
      report.updatedAt = now;
      return publicReport(report);
    },

    async submit(input) {
      const reporterSubjectHash = reporterHash(input.owner);
      const existing = reports.find(
        (report) =>
          report.reporterSubjectHash === reporterSubjectHash &&
          report.idempotencyKey === input.idempotencyKey,
      );
      if (existing) {
        assertIdempotentMatch(existing, input);
        return receiptFromReport(existing);
      }

      enforceMemoryLimits(reports, reporterSubjectHash, input);
      const now = new Date().toISOString();
      const report: MemoryReport = {
        category: input.category,
        createdAt: now,
        id: String(nextId++),
        idempotencyKey: input.idempotencyKey,
        message: input.message,
        questionId: input.questionId,
        questionTitle: input.questionTitle,
        questionVersionId: input.questionVersionId,
        questionVersionNumber: input.questionVersionId,
        reporterSubjectHash,
        status: "open",
        topicId: input.topicId,
        tutorSessionId: input.sessionId,
        updatedAt: now,
      };
      reports.push(report);
      return receiptFromReport(report);
    },
  };
}

export function createDatabaseQuestionFeedbackRepository(
  query: DatabaseQueryExecutor,
): QuestionFeedbackRepository {
  return {
    async getDashboard(authorization) {
      assertAuthorization(authorization, "professor");
      const [rows, countRows] = await Promise.all([
        readDatabaseRows(query, professorQueueSql()),
        readDatabaseRows(
          query,
          `select status, count(*)::int as count
           from feedback_reports
           where question_id is not null
             and question_version_id is not null
           group by status`,
        ),
      ]);
      const counts = emptyCounts();
      for (const row of countRows) {
        if (isQuestionFeedbackStatus(row.status)) {
          counts[row.status] = Number(row.count ?? 0);
        }
      }
      return {
        counts,
        reports: (rows as QuestionFeedbackRow[]).map(mapProfessorReport),
      };
    },

    async reviewReport(authorization, input) {
      assertAuthorization(authorization, "professor");
      const reviewer = reviewerAttribution(authorization);
      const updated = await query(
        `update feedback_reports
         set status = $2,
             resolution_notes = $3,
             assigned_to_user_id = case
               when $2 = 'open' then null
               else $4
             end,
             resolved_at = case
               when $2 in ('resolved', 'dismissed')
                 then coalesce(resolved_at, now())
               else null
             end
         where id = $1
         returning id`,
        [
          input.reportId,
          input.status,
          input.resolutionNotes ?? null,
          reviewer.userId,
        ],
      );
      if (!updated[0]) return undefined;

      const rows = await readDatabaseRows(
        query,
        professorQueueSql("where f.id = $1"),
        [input.reportId],
      );
      return rows[0]
        ? mapProfessorReport(rows[0] as QuestionFeedbackRow)
        : undefined;
    },

    async submit(input) {
      const reporterSubjectHash = reporterHash(input.owner);
      return runDatabaseTransaction(
        query,
        async (transactionQuery) => {
          const existing = await readExistingDatabaseReport(
            transactionQuery,
            reporterSubjectHash,
            input.idempotencyKey,
          );
          if (existing) {
            assertDatabaseIdempotentMatch(existing, input);
            return receiptFromRow(existing);
          }

          await enforceDatabaseLimits(
            transactionQuery,
            reporterSubjectHash,
            input,
          );
          const ownerId = ownerIdentifier(input.owner);
          const rows = await transactionQuery(
            `insert into feedback_reports (
               reporter_user_id,
               reporter_subject_hash,
               tutor_session_id,
               question_id,
               question_version_id,
               category,
               severity,
               status,
               message,
               metadata_json,
               idempotency_key
             )
             select
               null,
               $1,
               s.id,
               s.question_id,
               s.question_version_id,
               $5,
               'normal',
               'open',
               $6,
               '{}'::jsonb,
               $7
             from tutor_sessions s
             where s.id = $2
               and s.question_id = $3
               and s.question_version_id = $4
               and s.status in ('active', 'completed')
               and s.expires_at > now()
               and (
                 ($8 = 'user' and s.user_id = $9 and s.anonymous_user_id is null)
                 or
                 ($8 = 'anonymous' and s.anonymous_user_id = $9 and s.user_id is null)
               )
             on conflict (reporter_subject_hash, idempotency_key) do nothing
             returning *`,
            [
              reporterSubjectHash,
              input.sessionId,
              input.questionId,
              input.questionVersionId,
              input.category,
              input.message,
              input.idempotencyKey,
              input.owner.kind,
              ownerId,
            ],
          );
          const inserted = rows[0] as QuestionFeedbackRow | undefined;
          if (inserted) return receiptFromRow(inserted);

          const retry = await readExistingDatabaseReport(
            transactionQuery,
            reporterSubjectHash,
            input.idempotencyKey,
          );
          if (retry) {
            assertDatabaseIdempotentMatch(retry, input);
            return receiptFromRow(retry);
          }
          throw new QuestionFeedbackNotFoundError();
        },
        { retryOnConflict: true },
      );
    },
  };
}

export function setQuestionFeedbackRepositoryForTests(
  repository: QuestionFeedbackRepository | undefined,
) {
  questionFeedbackRepositoryOverride = repository;
}

export function resetQuestionFeedbackForTests() {
  memoryQuestionFeedbackRepository = createMemoryQuestionFeedbackRepository();
  questionFeedbackRepositoryOverride = undefined;
}

function normalizeStudentInput(input: {
  category: QuestionFeedbackCategory;
  details?: string;
  idempotencyKey: string;
  sessionId: string;
}) {
  if (!QUESTION_FEEDBACK_CATEGORIES.includes(input.category)) {
    throw new QuestionFeedbackValidationError(
      "Select a valid feedback category.",
    );
  }
  const sessionId = input.sessionId?.trim();
  if (!sessionId || sessionId.length > 200) {
    throw new QuestionFeedbackValidationError("A tutor session is required.");
  }
  const idempotencyKey = input.idempotencyKey?.trim();
  if (!idempotencyKey || idempotencyKey.length > 128) {
    throw new QuestionFeedbackValidationError(
      "A 1-128 character idempotency key is required.",
    );
  }
  const details = normalizeOptionalText(input.details, MAX_DETAILS_LENGTH, {
    field: "Report details",
    redactStudentData: true,
  });
  return { category: input.category, details, idempotencyKey, sessionId };
}

function normalizeReviewInput(input: ReviewRepositoryInput) {
  if (!/^\d+$/.test(input.reportId)) {
    throw new QuestionFeedbackValidationError(
      "A valid feedback report is required.",
    );
  }
  if (!QUESTION_FEEDBACK_STATUSES.includes(input.status)) {
    throw new QuestionFeedbackValidationError(
      "Select a valid feedback status.",
    );
  }
  const resolutionNotes = normalizeOptionalText(
    input.resolutionNotes,
    MAX_RESOLUTION_NOTES_LENGTH,
    { field: "Resolution notes", redactStudentData: false },
  );
  if (isTerminalStatus(input.status) && !resolutionNotes) {
    throw new QuestionFeedbackValidationError(
      "Resolution notes are required when resolving or dismissing a report.",
    );
  }
  return { ...input, resolutionNotes };
}

function normalizeOptionalText(
  value: string | undefined,
  maximumLength: number,
  options: { field: string; redactStudentData: boolean },
) {
  if (value === undefined) return undefined;
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!normalized) return undefined;
  if (normalized.length > maximumLength) {
    throw new QuestionFeedbackValidationError(
      `${options.field} must be ${maximumLength} characters or fewer.`,
    );
  }
  return options.redactStudentData
    ? redactStudentDetails(normalized)
    : normalized;
}

function redactStudentDetails(value: string) {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email removed]")
    .replace(
      /\b(?:bearer\s+)?(?:sk|pk|api)[-_][A-Za-z0-9_-]{12,}\b/gi,
      "[secret removed]",
    )
    .replace(/(?:\+?\d[\d ().-]{7,}\d)/g, "[number removed]");
}

function enforceMemoryLimits(
  reports: MemoryReport[],
  reporterSubjectHash: string,
  input: SubmitRepositoryInput,
) {
  const now = Date.now();
  const owned = reports.filter(
    (report) => report.reporterSubjectHash === reporterSubjectHash,
  );
  if (
    owned.filter(
      (report) => now - Date.parse(report.createdAt) < 60 * 60 * 1_000,
    ).length >= MAX_REPORTS_PER_HOUR
  ) {
    throw new QuestionFeedbackRateLimitError(60 * 60);
  }
  if (
    owned.filter(
      (report) =>
        report.tutorSessionId === input.sessionId &&
        report.category === input.category &&
        now - Date.parse(report.createdAt) < 24 * 60 * 60 * 1_000,
    ).length >= MAX_MATCHING_REPORTS_PER_DAY
  ) {
    throw new QuestionFeedbackRateLimitError(24 * 60 * 60);
  }
}

async function enforceDatabaseLimits(
  query: DatabaseQueryExecutor,
  reporterSubjectHash: string,
  input: SubmitRepositoryInput,
) {
  const rows = await readDatabaseRows(
    query,
    `select
       count(*) filter (
         where created_at >= now() - interval '1 hour'
       )::int as reports_last_hour,
       count(*) filter (
         where tutor_session_id = $2
           and category = $3
           and created_at >= now() - interval '24 hours'
       )::int as matching_reports_last_day
     from feedback_reports
     where reporter_subject_hash = $1`,
    [reporterSubjectHash, input.sessionId, input.category],
  );
  const counts = rows[0] ?? {};
  if (Number(counts.reports_last_hour ?? 0) >= MAX_REPORTS_PER_HOUR) {
    throw new QuestionFeedbackRateLimitError(60 * 60);
  }
  if (
    Number(counts.matching_reports_last_day ?? 0) >=
    MAX_MATCHING_REPORTS_PER_DAY
  ) {
    throw new QuestionFeedbackRateLimitError(24 * 60 * 60);
  }
}

async function readExistingDatabaseReport(
  query: DatabaseQueryExecutor,
  reporterSubjectHash: string,
  idempotencyKey: string,
) {
  const rows = await readDatabaseRows(
    query,
    `select *
     from feedback_reports
     where reporter_subject_hash = $1
       and idempotency_key = $2
     limit 1`,
    [reporterSubjectHash, idempotencyKey],
  );
  return rows[0] as QuestionFeedbackRow | undefined;
}

function assertDatabaseIdempotentMatch(
  existing: QuestionFeedbackRow,
  input: SubmitRepositoryInput,
) {
  if (
    existing.tutor_session_id !== input.sessionId ||
    existing.question_id !== input.questionId ||
    Number(existing.question_version_id) !== input.questionVersionId ||
    canonicalCategory(existing.category) !== input.category ||
    existing.message !== input.message
  ) {
    throw new QuestionFeedbackValidationError(
      "That idempotency key was already used for another report.",
    );
  }
}

function assertIdempotentMatch(
  existing: MemoryReport,
  input: SubmitRepositoryInput,
) {
  if (
    existing.tutorSessionId !== input.sessionId ||
    existing.questionId !== input.questionId ||
    existing.questionVersionId !== input.questionVersionId ||
    existing.category !== input.category ||
    existing.message !== input.message
  ) {
    throw new QuestionFeedbackValidationError(
      "That idempotency key was already used for another report.",
    );
  }
}

function reporterHash(owner: StudentOwner) {
  return createHash("sha256")
    .update(`question-feedback:v1:${owner.kind}:${ownerIdentifier(owner)}`)
    .digest("hex");
}

function ownerIdentifier(owner: StudentOwner) {
  return owner.kind === "user" ? owner.userId : owner.anonymousId;
}

function professorQueueSql(where = "") {
  return `select
      f.*,
      case f.category
        when 'content_error' then 'answer_appears_incorrect'
        when 'technical_issue' then 'technical_problem'
        when 'accessibility' then 'other'
        when 'privacy' then 'other'
        else f.category
      end as category,
      qv.version_number as question_version_number,
      coalesce(qv.snapshot_json ->> 'title', q.title) as question_title,
      qv.snapshot_json ->> 'topicId' as topic_id,
      assigned.display_name as assigned_to_display_name
    from feedback_reports f
    join questions q on q.id = f.question_id
    join question_versions qv
      on qv.id = f.question_version_id
     and qv.question_id = f.question_id
    left join users assigned on assigned.id = f.assigned_to_user_id
    ${where}
    order by
      case f.status
        when 'open' then 0
        when 'triaged' then 1
        else 2
      end,
      f.created_at,
      f.id
    limit 100`;
}

function mapProfessorReport(
  row: QuestionFeedbackRow,
): ProfessorQuestionFeedbackReport {
  return {
    assignedToDisplayName: row.assigned_to_display_name ?? undefined,
    category: canonicalCategory(row.category),
    createdAt: toIso(row.created_at),
    id: String(row.id),
    message: String(row.message),
    questionId: String(row.question_id),
    questionTitle: row.question_title ?? "Question",
    questionVersionId: Number(row.question_version_id),
    questionVersionNumber: Number(
      row.question_version_number ?? row.question_version_id,
    ),
    resolutionNotes: row.resolution_notes ?? undefined,
    resolvedAt: row.resolved_at ? toIso(row.resolved_at) : undefined,
    status: row.status,
    topicId: row.topic_id ?? undefined,
    tutorSessionId: String(row.tutor_session_id),
    updatedAt: toIso(row.updated_at),
  };
}

function canonicalCategory(value: string): QuestionFeedbackCategory {
  if (
    QUESTION_FEEDBACK_CATEGORIES.includes(value as QuestionFeedbackCategory)
  ) {
    return value as QuestionFeedbackCategory;
  }
  if (value === "content_error") return "answer_appears_incorrect";
  if (value === "technical_issue") return "technical_problem";
  return "other";
}

function receiptFromRow(row: QuestionFeedbackRow): QuestionFeedbackReceipt {
  return {
    acknowledgement: QUESTION_FEEDBACK_ACKNOWLEDGEMENT,
    category: canonicalCategory(row.category),
    createdAt: toIso(row.created_at),
    id: String(row.id),
    status: "open",
  };
}

function receiptFromReport(
  report: Pick<MemoryReport, "category" | "createdAt" | "id">,
): QuestionFeedbackReceipt {
  return {
    acknowledgement: QUESTION_FEEDBACK_ACKNOWLEDGEMENT,
    category: report.category,
    createdAt: report.createdAt,
    id: report.id,
    status: "open",
  };
}

function dashboardFromReports(
  reports: ProfessorQuestionFeedbackReport[],
): Omit<ProfessorQuestionFeedbackDashboard, "mode"> {
  const counts = emptyCounts();
  for (const report of reports) counts[report.status] += 1;
  return {
    counts,
    reports: [...reports].sort((left, right) => {
      const stateOrder = statusOrder(left.status) - statusOrder(right.status);
      return stateOrder || left.createdAt.localeCompare(right.createdAt);
    }),
  };
}

function emptyCounts(): Record<QuestionFeedbackStatus, number> {
  return { dismissed: 0, open: 0, resolved: 0, triaged: 0 };
}

function publicReport(report: MemoryReport): ProfessorQuestionFeedbackReport {
  const safe = structuredClone(report);
  Reflect.deleteProperty(safe, "idempotencyKey");
  Reflect.deleteProperty(safe, "reporterSubjectHash");
  return safe;
}

function statusOrder(status: QuestionFeedbackStatus) {
  return status === "open" ? 0 : status === "triaged" ? 1 : 2;
}

function isTerminalStatus(status: QuestionFeedbackStatus) {
  return status === "resolved" || status === "dismissed";
}

function isQuestionFeedbackStatus(
  value: unknown,
): value is QuestionFeedbackStatus {
  return QUESTION_FEEDBACK_STATUSES.includes(value as QuestionFeedbackStatus);
}

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

async function readWithConfiguredRepository(
  read: (
    repository: QuestionFeedbackRepository,
  ) => Promise<Omit<ProfessorQuestionFeedbackDashboard, "mode">>,
): Promise<ProfessorQuestionFeedbackDashboard> {
  const env = getServerEnv();
  const policy = getOperatingModePolicy();

  if (questionFeedbackRepositoryOverride) {
    try {
      return {
        ...(await read(questionFeedbackRepositoryOverride)),
        mode: policy.repositorySource,
      };
    } catch (cause) {
      if (!policy.allowDemoFallback || isQuestionFeedbackDomainError(cause)) {
        throw cause;
      }
      return {
        ...(await read(memoryQuestionFeedbackRepository)),
        mode: "demo",
      };
    }
  }

  if (policy.repositorySource === "demo") {
    return {
      ...(await read(memoryQuestionFeedbackRepository)),
      mode: "demo",
    };
  }
  if (!env.DATABASE_URL) {
    if (policy.allowDemoFallback) {
      return {
        ...(await read(memoryQuestionFeedbackRepository)),
        mode: "demo",
      };
    }
    throw new DataServiceUnavailableError("question-feedback");
  }
  try {
    return {
      ...(await read(createDatabaseQuestionFeedbackRepository(queryPostgres))),
      mode: "database",
    };
  } catch (cause) {
    if (policy.allowDemoFallback && !isQuestionFeedbackDomainError(cause)) {
      return {
        ...(await read(memoryQuestionFeedbackRepository)),
        mode: "demo",
      };
    }
    if (isQuestionFeedbackDomainError(cause)) throw cause;
    throw new DataServiceUnavailableError("question-feedback", { cause });
  }
}

async function writeWithConfiguredRepository<T>(
  write: (repository: QuestionFeedbackRepository) => Promise<T>,
) {
  const env = getServerEnv();
  const policy = getOperatingModePolicy();
  const repository = questionFeedbackRepositoryOverride
    ? questionFeedbackRepositoryOverride
    : policy.repositorySource === "demo"
      ? memoryQuestionFeedbackRepository
      : env.DATABASE_URL
        ? createDatabaseQuestionFeedbackRepository(queryPostgres)
        : undefined;

  if (!repository) {
    throw new DataServiceUnavailableError("question-feedback");
  }
  try {
    return await write(repository);
  } catch (cause) {
    if (isQuestionFeedbackDomainError(cause)) throw cause;
    throw new DataServiceUnavailableError("question-feedback", { cause });
  }
}

function isQuestionFeedbackDomainError(cause: unknown) {
  return (
    cause instanceof QuestionFeedbackValidationError ||
    cause instanceof QuestionFeedbackNotFoundError ||
    cause instanceof QuestionFeedbackRateLimitError
  );
}
