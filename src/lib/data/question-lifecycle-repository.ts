import "server-only";

import {
  assertAuthorization,
  reviewerAttribution,
  type ProfessorReviewAuthorization,
} from "@/lib/auth/authorization";
import {
  readDatabaseRows,
  runDatabaseTransaction,
  type DatabaseQueryExecutor,
  type DatabaseQueryValue,
} from "@/lib/data/database-executor";
import type {
  AdminQuestion,
  Misconception,
  ProfessorQuestionReviewCandidateDto,
  ProfessorReviewTopicSummaryDto,
  QuestionContent,
  QuestionCreationMethod,
  QuestionLifecycleAction,
  QuestionLifecycleDto,
  QuestionLifecycleEventAction,
  QuestionLifecycleEventDto,
  QuestionRecordState,
  QuestionRevisionMethod,
  QuestionValidationStatus,
  QuestionVersionDto,
  QuestionVersionState,
  SourceMetadata,
  SourceType,
  TrustLevel,
} from "@/lib/types";
import { generateDeterministicRegeneratedQuestion } from "@/lib/tutor/generated-question-regeneration";
import {
  allowedQuestionLifecycleActions,
  assertQuestionLifecycleTransition,
  QuestionLifecycleConflictError,
  QuestionLifecycleNotFoundError,
  QuestionLifecycleValidationError,
} from "@/lib/tutor/question-lifecycle";

export type QuestionVersionContentInput = QuestionContent & {
  source: SourceMetadata;
};

export type CreateQuestionInput = {
  content: QuestionVersionContentInput;
  creationMethod: QuestionCreationMethod;
  submit?: boolean;
};

export type CreateQuestionVersionInput = CreateQuestionInput & {
  baseVersionId: number;
  expectedWorkingVersionId: number;
  generationMetadata?: Record<string, unknown>;
  questionId: string;
  supersedeReason?: string;
};

export type QuestionLifecycleTransitionInput = {
  action: QuestionLifecycleAction;
  expectedState?: QuestionVersionState;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  note?: string;
  questionId: string;
  reasonCode?: string;
  requestId?: string;
  revisionMethod?: QuestionRevisionMethod;
  versionId: number;
};

export type QuestionLifecycleFilters = {
  recordState?: QuestionRecordState;
  sourceType?: SourceType;
  state?: QuestionVersionState;
  topicId?: string;
};

export type RegenerateQuestionVersionInput = {
  baseVersionId: number;
  expectedWorkingVersionId: number;
  idempotencyKey?: string;
  keepPattern?: boolean;
  questionId: string;
  requestId?: string;
  supersedeReason?: string;
};

type QuestionVersionRow = {
  accepted_answers_json: unknown;
  answer_explanation: string;
  content_sha256: string;
  created_by_display_name: string;
  created_by_user_id: string;
  difficulty: QuestionContent["difficulty"];
  hints_json: unknown;
  id: string;
  lifecycle_state: QuestionVersionState;
  misconceptions_json: unknown;
  numeric_value: number | null;
  originality_note: string | null;
  parent_version_id: number | string | null;
  pattern_id: string | null;
  prompt: string;
  question_version_id: number | string;
  record_state: QuestionRecordState;
  solution_steps_json: unknown;
  source_type: SourceType;
  title: string;
  tolerance: number | null;
  topic_id: string;
  trust_level: TrustLevel;
  validation_status: QuestionValidationStatus;
  version_created_at: Date | string;
  version_number: number;
  creation_method: QuestionCreationMethod;
  generation_metadata_json: unknown;
  schema_version: number;
  version_snapshot_json: unknown;
  visibility: SourceMetadata["visibility"];
  working_version_id: number | string;
  published_version_id: number | string | null;
};

type LifecycleEventRow = {
  action: QuestionLifecycleEventAction;
  actor_display_name: string;
  actor_role: "professor" | "system";
  actor_user_id: string;
  executed_by_display_name: string | null;
  executed_by_user_id: string | null;
  from_state: QuestionVersionState | null;
  id: number | string;
  note: string | null;
  occurred_at: Date | string;
  question_id: string;
  question_version_id: number | string;
  reason_code: string | null;
  request_id: string | null;
  requested_by_display_name: string | null;
  requested_by_user_id: string | null;
  to_state: QuestionVersionState | null;
};

type ProfessorReviewTopicSummaryRow = {
  approved: number | string;
  needs_review: number | string;
  rejected_or_revision_requested: number | string;
  remaining: number | string;
  sort_order: number | string;
  title: string;
  topic_id: string;
  total: number | string;
};

const PRIVATE_SOURCE_SIGNAL =
  /source page|answer key|solution key|worked example|copied from|verbatim|raw extracted|private chunk|embedding|textbook page|professor-only|course pdf|private phrase|source number/i;
const QUESTION_GENERATOR_USER_ID = "system:question-generator";

export function createDatabaseQuestionLifecycleRepository(
  query: DatabaseQueryExecutor,
) {
  return {
    async createQuestion(
      authorization: ProfessorReviewAuthorization,
      input: CreateQuestionInput,
    ) {
      assertAuthorization(authorization, "professor");
      validateQuestionVersionContent(input.content);
      const reviewer = reviewerAttribution(authorization);

      return runDatabaseTransaction(
        query,
        async (transactionQuery) => {
          const existing = await transactionQuery(
            "select id from questions where id = $1 limit 1",
            [input.content.id],
          );
          if (existing[0]) {
            throw new QuestionLifecycleConflictError(
              "A question with this stable ID already exists.",
            );
          }

          await setLifecycleActorContext(transactionQuery, {
            creationMethod: input.creationMethod,
            suppressVersions: true,
            userId: reviewer.userId,
          });
          await insertQuestionAggregate(
            transactionQuery,
            input.content,
            reviewer,
          );
          await transactionQuery(
            "select set_config('app.suppress_question_version', 'false', true)",
          );
          const rows = await transactionQuery(
            "select app_record_question_version($1) as version_id",
            [input.content.id],
          );
          const versionId = Number(rows[0]?.version_id);

          if (input.submit) {
            await applyTransition(transactionQuery, authorization, {
              action: "submit",
              expectedState: "draft",
              questionId: input.content.id,
              versionId,
            });
          }

          return requireQuestionLifecycle(transactionQuery, input.content.id);
        },
        { retryOnConflict: true },
      );
    },

    async createVersion(
      authorization: ProfessorReviewAuthorization,
      input: CreateQuestionVersionInput,
    ) {
      assertAuthorization(authorization, "professor");
      validateQuestionVersionContent(input.content, input.questionId);
      const reviewer = reviewerAttribution(authorization);

      return runDatabaseTransaction(
        query,
        async (transactionQuery) => {
          const rows = await transactionQuery(
            `
              select q.record_state, q.working_version_id, q.published_version_id,
                     qvl.state as working_state
              from questions q
              join question_version_lifecycle qvl
                on qvl.question_version_id = q.working_version_id
              where q.id = $1
              for update of q, qvl
            `,
            [input.questionId],
          );
          const current = rows[0];
          if (!current) {
            return undefined;
          }
          if (current.record_state !== "active") {
            throw new QuestionLifecycleConflictError(
              "Archived questions must be restored before creating a version.",
            );
          }
          if (
            Number(current.working_version_id) !==
            input.expectedWorkingVersionId
          ) {
            throw new QuestionLifecycleConflictError(
              "The working question version changed. Refresh before editing.",
            );
          }
          if (
            input.baseVersionId !== input.expectedWorkingVersionId &&
            !input.supersedeReason?.trim()
          ) {
            throw new QuestionLifecycleConflictError(
              "Creating from a non-working version requires a supersede reason.",
            );
          }

          const base = await transactionQuery(
            `select id from question_versions
             where id = $1 and question_id = $2 limit 1`,
            [input.baseVersionId, input.questionId],
          );
          if (!base[0]) {
            throw new QuestionLifecycleConflictError(
              "The selected base version does not belong to this question.",
            );
          }

          const versionId = await insertQuestionVersion(transactionQuery, {
            content: input.content,
            creationMethod: input.creationMethod,
            createdByUserId:
              input.creationMethod === "generated" ||
              input.creationMethod === "regenerated"
                ? QUESTION_GENERATOR_USER_ID
                : reviewer.userId,
            generationMetadata:
              input.creationMethod === "generated" ||
              input.creationMethod === "regenerated"
                ? {
                    ...input.generationMetadata,
                    executedByUserId: QUESTION_GENERATOR_USER_ID,
                    requestedByUserId: reviewer.userId,
                  }
                : input.generationMetadata,
            parentVersionId: input.baseVersionId,
            supersedeReason: input.supersedeReason,
          });

          if (input.submit) {
            await applyTransition(transactionQuery, authorization, {
              action: "submit",
              expectedState: "draft",
              questionId: input.questionId,
              versionId,
            });
          }

          return requireQuestionLifecycle(transactionQuery, input.questionId);
        },
        { retryOnConflict: true },
      );
    },

    async getQuestion(
      authorization: ProfessorReviewAuthorization,
      questionId: string,
    ) {
      assertAuthorization(authorization, "professor");
      return selectQuestionLifecycle(query, questionId);
    },

    async listQuestions(
      authorization: ProfessorReviewAuthorization,
      filters: QuestionLifecycleFilters = {},
    ) {
      assertAuthorization(authorization, "professor");
      const rows = await selectQuestionVersionRows(query);
      const events = await selectLifecycleEvents(query);
      return buildQuestionLifecycles(rows, events).filter((question) => {
        const version = question.workingVersion;
        return (
          (!filters.recordState ||
            question.recordState === filters.recordState) &&
          (!filters.state || version.state === filters.state) &&
          (!filters.topicId || version.topicId === filters.topicId) &&
          (!filters.sourceType ||
            version.source.sourceType === filters.sourceType)
        );
      });
    },

    async listReviewTopicSummaries(
      authorization: ProfessorReviewAuthorization,
    ) {
      assertAuthorization(authorization, "professor");
      const rows = (await readDatabaseRows(
        query,
        `
          select
            t.id as topic_id,
            t.title,
            t.sort_order,
            count(qvc.id)::int as total,
            count(*) filter (
              where qvc.lifecycle_state = 'needs_review'
            )::int as needs_review,
            count(*) filter (
              where qvc.lifecycle_state in ('approved', 'published', 'unpublished')
            )::int as approved,
            count(*) filter (
              where qvc.lifecycle_state in ('rejected', 'revision_requested')
            )::int as rejected_or_revision_requested,
            count(*) filter (
              where qvc.lifecycle_state in ('draft', 'needs_review', 'revision_requested')
            )::int as remaining
          from topics t
          left join app_question_version_content qvc
            on qvc.topic_id = t.id
           and qvc.record_state = 'active'
           and qvc.working_version_id = qvc.question_version_id
          where t.is_active = true
          group by t.id, t.title, t.sort_order
          order by t.sort_order, t.title, t.id
        `,
      )) as ProfessorReviewTopicSummaryRow[];

      return rows.map(mapProfessorReviewTopicSummary);
    },

    async listReviewCandidates(
      authorization: ProfessorReviewAuthorization,
      topicId: string,
    ) {
      assertAuthorization(authorization, "professor");
      const rows = (await readDatabaseRows(
        query,
        `
          select
            qvc.*,
            qv.snapshot_json as version_snapshot_json,
            qv.created_at as version_created_at,
            qv.created_by_user_id,
            u.display_name as created_by_display_name
          from app_question_version_content qvc
          join question_versions qv on qv.id = qvc.question_version_id
          join users u on u.id = qv.created_by_user_id
          join topics t on t.id = qvc.topic_id and t.is_active = true
          where qvc.topic_id = $1
            and qvc.record_state = 'active'
            and qvc.working_version_id = qvc.question_version_id
            and qvc.lifecycle_state = 'needs_review'
          order by
            case when qvc.review_priority = 'priority' then 0 else 1 end,
            qv.created_at,
            qvc.title,
            qvc.id
        `,
        [topicId],
      )) as QuestionVersionRow[];

      return rows.map(mapProfessorQuestionReviewCandidate);
    },

    async regenerate(
      authorization: ProfessorReviewAuthorization,
      input: RegenerateQuestionVersionInput,
    ) {
      assertAuthorization(authorization, "professor");
      const reviewer = reviewerAttribution(authorization);
      if (input.idempotencyKey) {
        const prior = await readDatabaseRows(
          query,
          `select question_version_id
           from question_lifecycle_events
           where question_id = $1
             and idempotency_key = $2
             and action = 'regenerate'
           limit 1`,
          [input.questionId, input.idempotencyKey],
        );
        if (prior[0]) {
          return requireQuestionLifecycle(query, input.questionId);
        }
      }
      const lifecycle = await requireQuestionLifecycle(query, input.questionId);
      const base = lifecycle.versions.find(
        (version) => version.versionId === input.baseVersionId,
      );
      if (!base) {
        return undefined;
      }
      if (
        base.source.sourceType !== "generated_original" &&
        base.source.sourceType !== "pattern_derived_original"
      ) {
        throw new QuestionLifecycleConflictError(
          "Only generated or pattern-derived questions can be regenerated.",
        );
      }
      if (
        ["draft", "needs_review", "revision_requested", "approved"].includes(
          lifecycle.workingVersion.state,
        ) &&
        lifecycle.workingVersion.versionId !==
          lifecycle.publishedVersion?.versionId &&
        !input.supersedeReason?.trim()
      ) {
        throw new QuestionLifecycleConflictError(
          "An actionable working version already exists. Record a supersede reason before regenerating.",
        );
      }

      const generated = generateDeterministicRegeneratedQuestion({
        id: lifecycle.questionId,
        keepPattern: input.keepPattern ?? true,
        original: versionToAdminQuestion(base),
        sequence: lifecycle.versions.length + 1,
      });
      const repository = createDatabaseQuestionLifecycleRepository(query);
      try {
        return await repository.createVersion(authorization, {
          baseVersionId: input.baseVersionId,
          content: generated,
          creationMethod: "regenerated",
          expectedWorkingVersionId: input.expectedWorkingVersionId,
          generationMetadata: {
            generator: "deterministic-v1",
            idempotencyKey: input.idempotencyKey,
            keepPattern: input.keepPattern ?? true,
            requestId: input.requestId,
            sequence: lifecycle.versions.length + 1,
          },
          questionId: input.questionId,
          submit: true,
          supersedeReason: input.supersedeReason,
        });
      } catch (error) {
        if (input.idempotencyKey) {
          const duplicate = await readDatabaseRows(
            query,
            `select 1 from question_lifecycle_events
             where question_id = $1
               and idempotency_key = $2
               and action = 'regenerate'
             limit 1`,
            [input.questionId, input.idempotencyKey],
          );
          if (duplicate[0]) {
            return requireQuestionLifecycle(query, input.questionId);
          }
        }
        await recordRegenerationFailure(query, {
          error,
          questionId: input.questionId,
          requestId: input.requestId,
          reviewer,
        });
        throw error;
      }
    },

    async transition(
      authorization: ProfessorReviewAuthorization,
      input: QuestionLifecycleTransitionInput,
    ) {
      assertAuthorization(authorization, "professor");
      return runDatabaseTransaction(
        query,
        async (transactionQuery) => {
          await applyTransition(transactionQuery, authorization, input);
          return requireQuestionLifecycle(transactionQuery, input.questionId);
        },
        { retryOnConflict: true },
      );
    },
  };
}

async function applyTransition(
  query: DatabaseQueryExecutor,
  authorization: ProfessorReviewAuthorization,
  input: QuestionLifecycleTransitionInput,
) {
  const current = await requireQuestionLifecycle(query, input.questionId);
  const version = current.versions.find(
    (candidate) => candidate.versionId === input.versionId,
  );
  if (!version) {
    throw new QuestionLifecycleNotFoundError("Question version was not found.");
  }

  if (
    ["submit", "request_revision", "approve", "reject", "publish"].includes(
      input.action,
    ) &&
    version.versionId !== current.workingVersion.versionId
  ) {
    throw new QuestionLifecycleConflictError(
      `${input.action} requires the current working version.`,
    );
  }

  if (input.idempotencyKey) {
    const existing = await readDatabaseRows(
      query,
      `select action, question_version_id
       from question_lifecycle_events
       where question_id = $1 and idempotency_key = $2
       limit 1`,
      [input.questionId, input.idempotencyKey],
    );
    if (existing[0]) {
      if (
        existing[0].action !== input.action ||
        Number(existing[0].question_version_id) !== input.versionId
      ) {
        throw new QuestionLifecycleConflictError(
          "The idempotency key was already used for a different lifecycle transition.",
        );
      }
      return;
    }
  }

  assertQuestionLifecycleTransition({
    action: input.action,
    hasPublishedVersion: Boolean(current.publishedVersion),
    reasonCode: input.reasonCode,
    recordState: current.recordState,
    revisionMethod: input.revisionMethod,
    versionState: version.state,
  });

  if (["approve", "publish", "rollback"].includes(input.action)) {
    if (version.schemaVersion !== 2) {
      throw new QuestionLifecycleValidationError(
        "The question version must be cloned into the current content schema before approval or publication.",
      );
    }
    validateQuestionVersionContent(version, input.questionId);
    const activeTopic = await readDatabaseRows(
      query,
      `select id from topics
       where id = $1 and is_active = true
       limit 1`,
      [version.topicId],
    );
    if (!activeTopic[0]) {
      throw new QuestionLifecycleValidationError(
        "The question topic is unavailable under the current publication policy.",
      );
    }
  }

  const reviewer = reviewerAttribution(authorization);
  try {
    await query(
      `select * from app_transition_question_version(
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb
      )`,
      [
        input.questionId,
        input.versionId,
        input.action,
        reviewer.userId,
        reviewer.displayName,
        input.expectedState ?? null,
        input.reasonCode ?? null,
        input.note?.slice(0, 1000) ?? null,
        input.idempotencyKey ?? null,
        input.requestId ?? null,
        JSON.stringify({
          ...input.metadata,
          revisionMethod: input.revisionMethod,
        }),
      ],
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Lifecycle change failed.";
    if (/requires a reason|valid question/i.test(message)) {
      throw new QuestionLifecycleValidationError(message);
    }
    throw new QuestionLifecycleConflictError(message);
  }
}

async function insertQuestionVersion(
  query: DatabaseQueryExecutor,
  input: {
    content: QuestionVersionContentInput;
    creationMethod: QuestionCreationMethod;
    createdByUserId: string;
    generationMetadata?: Record<string, unknown>;
    parentVersionId: number;
    supersedeReason?: string;
  },
) {
  const snapshot = snapshotForContent(input.content);
  await query("select set_config('app.current_supersede_reason', $1, true)", [
    input.supersedeReason?.slice(0, 1_000) ?? "",
  ]);
  const rows = await query(
    `
      insert into question_versions (
        question_id,
        version_number,
        snapshot_json,
        content_hash,
        created_by_user_id,
        parent_version_id,
        creation_method,
        schema_version,
        generation_metadata_json
      )
      select
        $1,
        coalesce(max(qv.version_number), 0) + 1,
        $2::jsonb,
        md5(($2::jsonb)::text),
        $3,
        $4,
        $5,
        2,
        $6::jsonb
      from question_versions qv
      where qv.question_id = $1
      returning id
    `,
    [
      input.content.id,
      JSON.stringify(snapshot),
      input.createdByUserId,
      input.parentVersionId,
      input.creationMethod,
      JSON.stringify(input.generationMetadata ?? {}),
    ],
  );
  return Number(rows[0].id);
}

async function recordRegenerationFailure(
  query: DatabaseQueryExecutor,
  input: {
    error: unknown;
    questionId: string;
    requestId?: string;
    reviewer: { displayName: string; userId: string };
  },
) {
  const errorName =
    input.error instanceof Error ? input.error.name : "UnknownGenerationError";
  try {
    await query(
      `insert into audit_events (
        actor_user_id, actor_subject, action, entity_type, entity_id,
        outcome, request_id, metadata_json
      )
      values ($1, $1, 'question_lifecycle.regenerate', 'question', $2,
              'failure', $3, $4::jsonb)`,
      [
        input.reviewer.userId,
        input.questionId,
        input.requestId ?? null,
        JSON.stringify({ errorName: errorName.slice(0, 120) }),
      ],
    );
  } catch {
    // The original regeneration failure is authoritative when audit storage is
    // unavailable; callers still receive it without leaking private inputs.
  }
}

async function insertQuestionAggregate(
  query: DatabaseQueryExecutor,
  content: QuestionVersionContentInput,
  reviewer: { displayName: string; userId: string },
) {
  const generated =
    content.source.sourceType === "generated_original" ||
    content.source.sourceType === "pattern_derived_original";
  await query(
    `
      insert into questions (
        id, topic_id, pattern_id, title, prompt, difficulty,
        accepted_answers_json, numeric_value, tolerance, answer_explanation,
        source_type, trust_level, review_status, visibility, originality_note,
        review_priority, reviewed_by, reviewed_by_user_id, reviewed_at
      )
      values (
        $1, $2, $3, $4, $5, $6,
        $7::jsonb, $8, $9, $10,
        $11, $12, 'needs_review', 'public', $13,
        'normal', $14, $15, now()
      )
    `,
    [
      content.id,
      content.topicId,
      content.source.patternIds?.[0] ?? null,
      content.title,
      content.prompt,
      content.difficulty,
      JSON.stringify(content.answer.acceptedAnswers),
      content.answer.numericValue ?? null,
      content.answer.tolerance ?? null,
      content.answer.explanation,
      content.source.sourceType,
      generated ? "generated_unverified" : content.source.trustLevel,
      content.source.originalityNote ?? null,
      reviewer.displayName,
      reviewer.userId,
    ],
  );

  for (const [index, hint] of content.hints.entries()) {
    await query(
      "insert into hints (question_id, hint_order, body) values ($1, $2, $3)",
      [content.id, index + 1, hint],
    );
  }
  for (const [index, step] of content.solutionSteps.entries()) {
    await query(
      "insert into solution_steps (question_id, step_order, body) values ($1, $2, $3)",
      [content.id, index + 1, step],
    );
  }
  for (const misconception of content.misconceptions) {
    await query(
      `insert into misconceptions (
        id, question_id, feedback, match_terms_json
      ) values ($1, $2, $3, $4::jsonb)`,
      [
        misconception.id,
        content.id,
        misconception.feedback,
        JSON.stringify(misconception.matchTerms),
      ],
    );
  }
}

async function setLifecycleActorContext(
  query: DatabaseQueryExecutor,
  input: {
    creationMethod: QuestionCreationMethod;
    suppressVersions: boolean;
    userId: string;
  },
) {
  await query(
    `select
      set_config('app.current_user_id', $1, true),
      set_config('app.current_creation_method', $2, true),
      set_config('app.suppress_question_version', $3, true),
      set_config('app.current_supersede_reason', '', true)`,
    [input.userId, input.creationMethod, String(input.suppressVersions)],
  );
}

async function requireQuestionLifecycle(
  query: DatabaseQueryExecutor,
  questionId: string,
) {
  const result = await selectQuestionLifecycle(query, questionId);
  if (!result) {
    throw new QuestionLifecycleNotFoundError("Question was not found.");
  }
  return result;
}

async function selectQuestionLifecycle(
  query: DatabaseQueryExecutor,
  questionId: string,
) {
  const [rows, events] = await Promise.all([
    selectQuestionVersionRows(query, questionId),
    selectLifecycleEvents(query, questionId),
  ]);
  return buildQuestionLifecycles(rows, events)[0];
}

async function selectQuestionVersionRows(
  query: DatabaseQueryExecutor,
  questionId?: string,
) {
  const params: DatabaseQueryValue[] = [];
  const where = questionId
    ? (params.push(questionId), "where qvc.id = $1")
    : "";
  return (await readDatabaseRows(
    query,
    `
      select
        qvc.*,
        qv.snapshot_json as version_snapshot_json,
        qv.created_at as version_created_at,
        qv.created_by_user_id,
        u.display_name as created_by_display_name
      from app_question_version_content qvc
      join question_versions qv on qv.id = qvc.question_version_id
      join users u on u.id = qv.created_by_user_id
      ${where}
      order by qvc.id, qvc.version_number desc, qvc.question_version_id desc
    `,
    params,
  )) as QuestionVersionRow[];
}

async function selectLifecycleEvents(
  query: DatabaseQueryExecutor,
  questionId?: string,
) {
  const params: DatabaseQueryValue[] = [];
  const where = questionId
    ? (params.push(questionId), "where question_id = $1")
    : "";
  return (await readDatabaseRows(
    query,
    `select
       qle.*,
       requested.display_name as requested_by_display_name,
       executed.display_name as executed_by_display_name
     from question_lifecycle_events qle
     left join users requested on requested.id = qle.requested_by_user_id
     left join users executed on executed.id = qle.executed_by_user_id
     ${where ? where.replace("question_id", "qle.question_id") : ""}
     order by qle.question_id, qle.occurred_at desc, qle.id desc`,
    params,
  )) as LifecycleEventRow[];
}

function buildQuestionLifecycles(
  rows: QuestionVersionRow[],
  eventRows: LifecycleEventRow[],
) {
  const eventsByQuestion = new Map<string, QuestionLifecycleEventDto[]>();
  for (const row of eventRows) {
    const events = eventsByQuestion.get(row.question_id) ?? [];
    events.push(mapLifecycleEvent(row));
    eventsByQuestion.set(row.question_id, events);
  }

  const rowsByQuestion = new Map<string, QuestionVersionRow[]>();
  for (const row of rows) {
    const values = rowsByQuestion.get(row.id) ?? [];
    values.push(row);
    rowsByQuestion.set(row.id, values);
  }

  return [...rowsByQuestion.entries()].map(([questionId, questionRows]) => {
    const versions = questionRows.map(mapQuestionVersion);
    const first = questionRows[0];
    const workingVersion = versions.find(
      (version) => version.versionId === Number(first.working_version_id),
    );
    if (!workingVersion) {
      throw new Error(`Question ${questionId} has no working version.`);
    }
    const publishedVersion = versions.find(
      (version) => version.versionId === Number(first.published_version_id),
    );
    return {
      allowedActions: allowedQuestionLifecycleActions({
        hasPublishedVersion: Boolean(publishedVersion),
        recordState: first.record_state,
        versionState: workingVersion.state,
      }),
      events: eventsByQuestion.get(questionId) ?? [],
      publishedVersion,
      questionId,
      recordState: first.record_state,
      regenerationAllowed:
        first.record_state === "active" &&
        (workingVersion.source.sourceType === "generated_original" ||
          workingVersion.source.sourceType === "pattern_derived_original"),
      versions,
      workingVersion,
    } satisfies QuestionLifecycleDto;
  });
}

function mapQuestionVersion(row: QuestionVersionRow): QuestionVersionDto {
  const snapshot = recordValue(row.version_snapshot_json);
  return {
    allowedActions: allowedActionsForVersionRow(row),
    answer: {
      acceptedAnswers: stringArray(row.accepted_answers_json),
      explanation: row.answer_explanation,
      numericValue: row.numeric_value ?? undefined,
      tolerance: row.tolerance ?? undefined,
    },
    contentHash: row.content_sha256,
    createdAt: toIsoString(row.version_created_at)!,
    createdBy: {
      displayName: row.created_by_display_name,
      occurredAt: toIsoString(row.version_created_at)!,
      userId: row.created_by_user_id,
    },
    creationMethod: row.creation_method,
    difficulty: row.difficulty,
    hints: stringArray(row.hints_json),
    id: row.id,
    misconceptions: misconceptionArray(row.misconceptions_json),
    parentVersionId:
      row.parent_version_id === null
        ? undefined
        : Number(row.parent_version_id),
    prompt: row.prompt,
    generationMetadata: safeGenerationMetadataForProfessor(
      row.generation_metadata_json,
    ),
    schemaVersion: Number(row.schema_version),
    solutionSteps: stringArray(row.solution_steps_json),
    source: {
      originalityNote: row.originality_note ?? undefined,
      patternIds: row.pattern_id ? [row.pattern_id] : undefined,
      sourceType: row.source_type,
      trustLevel: row.trust_level,
      visibility: snapshot?.visibility === "private" ? "private" : "public",
    },
    state: row.lifecycle_state,
    title: row.title,
    topicId: row.topic_id,
    validationStatus: row.validation_status,
    versionId: Number(row.question_version_id),
    versionNumber: Number(row.version_number),
  };
}

function mapProfessorReviewTopicSummary(
  row: ProfessorReviewTopicSummaryRow,
): ProfessorReviewTopicSummaryDto {
  return {
    approved: Number(row.approved),
    needsReview: Number(row.needs_review),
    order: Number(row.sort_order),
    rejectedOrRevisionRequested: Number(row.rejected_or_revision_requested),
    remaining: Number(row.remaining),
    title: row.title,
    topicId: row.topic_id,
    total: Number(row.total),
  };
}

function mapProfessorQuestionReviewCandidate(
  row: QuestionVersionRow,
): ProfessorQuestionReviewCandidateDto {
  const version = mapQuestionVersion(row);
  if (version.state !== "needs_review") {
    throw new Error("Professor review candidates must be in needs_review.");
  }

  return {
    allowedActions: [...version.allowedActions],
    answer: {
      ...version.answer,
      acceptedAnswers: [...version.answer.acceptedAnswers],
    },
    createdAt: version.createdAt,
    createdBy: {
      displayName: version.createdBy.displayName,
      occurredAt: version.createdBy.occurredAt,
    },
    creationMethod: version.creationMethod,
    difficulty: version.difficulty,
    hints: [...version.hints],
    id: version.id,
    misconceptions: version.misconceptions.map(({ feedback, id }) => ({
      feedback,
      id,
    })),
    prompt: version.prompt,
    publishedVersionId:
      row.published_version_id === null
        ? undefined
        : Number(row.published_version_id),
    questionId: row.id,
    review: {
      reviewPriority:
        recordValue(row.version_snapshot_json)?.reviewPriority === "priority"
          ? "priority"
          : "normal",
      status: "needs_review",
    },
    solutionSteps: [...version.solutionSteps],
    source: {
      originalityNote: version.source.originalityNote,
      sourceType: version.source.sourceType,
      trustLevel: version.source.trustLevel,
    },
    state: "needs_review",
    title: version.title,
    topicId: version.topicId,
    validationStatus: version.validationStatus,
    versionId: version.versionId,
    versionNumber: version.versionNumber,
  };
}

function allowedActionsForVersionRow(
  row: QuestionVersionRow,
): QuestionLifecycleAction[] {
  const versionId = Number(row.question_version_id);
  if (row.record_state === "archived") {
    return versionId === Number(row.working_version_id) ? ["restore"] : [];
  }
  if (versionId === Number(row.working_version_id)) {
    return allowedQuestionLifecycleActions({
      hasPublishedVersion: row.published_version_id !== null,
      recordState: row.record_state,
      versionState: row.lifecycle_state,
    });
  }
  if (versionId === Number(row.published_version_id)) {
    return ["unpublish"];
  }
  return row.lifecycle_state === "unpublished" ? ["rollback"] : [];
}

function mapLifecycleEvent(row: LifecycleEventRow): QuestionLifecycleEventDto {
  const occurredAt = toIsoString(row.occurred_at)!;
  return {
    action: row.action,
    actor: {
      displayName: row.actor_display_name,
      occurredAt,
      userId: row.actor_user_id,
    },
    actorRole: row.actor_role,
    executedBy:
      row.executed_by_user_id && row.executed_by_display_name
        ? {
            displayName: row.executed_by_display_name,
            occurredAt,
            userId: row.executed_by_user_id,
          }
        : undefined,
    fromState: row.from_state ?? undefined,
    id: Number(row.id),
    note: row.note ?? undefined,
    reasonCode: row.reason_code ?? undefined,
    requestId: row.request_id ?? undefined,
    requestedBy:
      row.requested_by_user_id && row.requested_by_display_name
        ? {
            displayName: row.requested_by_display_name,
            occurredAt,
            userId: row.requested_by_user_id,
          }
        : undefined,
    toState: row.to_state ?? undefined,
    versionId: Number(row.question_version_id),
  };
}

function snapshotForContent(content: QuestionVersionContentInput) {
  return {
    acceptedAnswers: content.answer.acceptedAnswers,
    answerExplanation: content.answer.explanation,
    difficulty: content.difficulty,
    hints: content.hints.map((body, index) => ({ body, order: index + 1 })),
    id: content.id,
    misconceptions: content.misconceptions.map((misconception) => ({
      feedback: misconception.feedback,
      id: misconception.id,
      matchTerms: misconception.matchTerms,
      metadata: {},
    })),
    numericValue: content.answer.numericValue ?? null,
    originalityNote: content.source.originalityNote ?? null,
    patternId: content.source.patternIds?.[0] ?? null,
    prompt: content.prompt,
    reviewPriority: "normal",
    reviewStatus: "needs_review",
    schemaVersion: 2,
    solutionSteps: content.solutionSteps.map((body, index) => ({
      body,
      order: index + 1,
    })),
    sourceType: content.source.sourceType,
    title: content.title,
    tolerance: content.answer.tolerance ?? null,
    topicId: content.topicId,
    trustLevel: content.source.trustLevel,
    visibility: content.source.visibility,
  };
}

function safeGenerationMetadataForProfessor(value: unknown) {
  const metadata = recordValue(value);
  if (!metadata) return {};
  const safe: Record<string, boolean | number | string> = {};
  for (const key of [
    "configId",
    "generator",
    "generatorId",
    "jobId",
    "keepPattern",
    "seed",
    "sequence",
  ] as const) {
    const candidate = metadata[key];
    if (
      typeof candidate === "boolean" ||
      (typeof candidate === "number" && Number.isFinite(candidate)) ||
      (typeof candidate === "string" && candidate.length <= 200)
    ) {
      safe[key] = candidate;
    }
  }
  return safe;
}

function validateQuestionVersionContent(
  content: QuestionVersionContentInput,
  expectedQuestionId = content.id,
) {
  if (content.id !== expectedQuestionId) {
    throw new QuestionLifecycleValidationError(
      "Version content must retain the stable question ID.",
    );
  }
  const required = [
    content.id,
    content.topicId,
    content.title,
    content.prompt,
    content.answer.explanation,
  ];
  if (required.some((value) => !value.trim())) {
    throw new QuestionLifecycleValidationError(
      "Question versions require an ID, topic, title, prompt, and explanation.",
    );
  }
  if (content.answer.acceptedAnswers.length === 0) {
    throw new QuestionLifecycleValidationError(
      "Question versions require at least one accepted answer.",
    );
  }
  if (content.solutionSteps.length === 0) {
    throw new QuestionLifecycleValidationError(
      "Question versions require at least one solution step.",
    );
  }
  if (content.source.visibility !== "public") {
    throw new QuestionLifecycleValidationError(
      "Professor question versions must contain public-safe content.",
    );
  }
  const searchable = [
    content.title,
    content.prompt,
    content.answer.explanation,
    content.source.originalityNote,
    ...content.hints,
    ...content.solutionSteps,
    ...content.misconceptions.map((item) => item.feedback),
  ]
    .filter(Boolean)
    .join(" ");
  if (PRIVATE_SOURCE_SIGNAL.test(searchable)) {
    throw new QuestionLifecycleValidationError(
      "Question content contains private-source wording that cannot be versioned.",
    );
  }
}

function versionToAdminQuestion(version: QuestionVersionDto): AdminQuestion {
  return {
    answer: {
      ...version.answer,
      acceptedAnswers: [...version.answer.acceptedAnswers],
    },
    difficulty: version.difficulty,
    hints: [...version.hints],
    id: version.id,
    misconceptions: version.misconceptions.map((item) => ({
      ...item,
      matchTerms: [...item.matchTerms],
    })),
    patternSource: version.source.patternIds?.[0] ?? version.source.sourceType,
    prompt: version.prompt,
    review: {
      reviewPriority: "normal",
      status: version.state === "rejected" ? "rejected" : "needs_review",
    },
    solutionSteps: [...version.solutionSteps],
    source: { ...version.source },
    title: version.title,
    topicId: version.topicId,
  };
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function misconceptionArray(value: unknown): Misconception[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((value) => {
    const item = recordValue(value);
    if (
      !item ||
      typeof item.id !== "string" ||
      typeof item.feedback !== "string"
    ) {
      return [];
    }
    return [
      {
        feedback: item.feedback,
        id: item.id,
        matchTerms: stringArray(item.matchTerms),
      },
    ];
  });
}

function toIsoString(value: Date | string | null | undefined) {
  if (!value) {
    return undefined;
  }
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
