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
} from "@/lib/data/database-executor";
import type {
  StudentContentAvailabilityDashboard,
  StudentContentAvailabilityEvent,
  StudentContentAvailabilityTarget,
  StudentContentPublicationState,
  StudentContentReleaseState,
} from "@/lib/types";

export type ContentAvailabilityUpdateInput = {
  availableFrom?: string;
  availableUntil?: string;
  reason?: string;
  releaseState: StudentContentReleaseState;
  requestId?: string;
  targetId: string;
  targetType: "topic" | "question";
};

type AvailabilityTargetRow = {
  audience_type: "global" | null;
  available_from: Date | string | null;
  available_until: Date | string | null;
  id: string;
  is_active?: boolean;
  publication_state: StudentContentPublicationState;
  release_state: StudentContentReleaseState | null;
  title: string;
  topic_id?: string | null;
  topic_title?: string | null;
};

type AvailabilityEventRow = {
  actor_display_name: string;
  actor_user_id: string;
  from_available_from: Date | string | null;
  from_available_until: Date | string | null;
  from_release_state: StudentContentReleaseState;
  id: number | string;
  occurred_at: Date | string;
  reason: string | null;
  request_id: string | null;
  target_id: string;
  target_type: "topic" | "question";
  to_available_from: Date | string | null;
  to_available_until: Date | string | null;
  to_release_state: StudentContentReleaseState;
};

export class ContentAvailabilityNotFoundError extends Error {
  constructor(message = "The availability target was not found.") {
    super(message);
    this.name = "ContentAvailabilityNotFoundError";
  }
}

export class ContentAvailabilityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentAvailabilityValidationError";
  }
}

export function createDatabaseContentAvailabilityRepository(
  query: DatabaseQueryExecutor,
) {
  return {
    async getDashboard(
      authorization: ProfessorReviewAuthorization,
    ): Promise<StudentContentAvailabilityDashboard> {
      assertAuthorization(authorization, "professor");
      return readAvailabilityDashboard(query);
    },

    async updateAvailability(
      authorization: ProfessorReviewAuthorization,
      input: ContentAvailabilityUpdateInput,
    ): Promise<StudentContentAvailabilityDashboard> {
      assertAuthorization(authorization, "professor");
      const reviewer = reviewerAttribution(authorization);
      const normalized = normalizeAvailabilityInput(input);

      await runDatabaseTransaction(
        query,
        async (transactionQuery) => {
          await assertEligibleTarget(transactionQuery, normalized);
          const table =
            normalized.targetType === "topic"
              ? "topic_student_availability"
              : "question_student_availability";
          const idColumn =
            normalized.targetType === "topic" ? "topic_id" : "question_id";
          const existingRows = await transactionQuery(
            `select release_state, available_from, available_until
             from ${table}
             where ${idColumn} = $1
             for update`,
            [normalized.targetId],
          );
          const existing = existingRows[0];
          const existingState = String(
            existing?.release_state ?? "published",
          ) as StudentContentReleaseState;
          const existingFrom = optionalIso(existing?.available_from);
          const existingUntil = optionalIso(existing?.available_until);

          if (
            existingState === normalized.releaseState &&
            existingFrom === normalized.availableFrom &&
            existingUntil === normalized.availableUntil
          ) {
            return;
          }

          await transactionQuery(
            "select set_config('app.current_user_id', $1, true)",
            [reviewer.userId],
          );
          await transactionQuery(
            "select set_config('app.availability_change_reason', $1, true)",
            [normalized.reason ?? ""],
          );
          await transactionQuery(
            "select set_config('app.availability_request_id', $1, true)",
            [normalized.requestId ?? ""],
          );
          await transactionQuery(
            `insert into ${table} (
               ${idColumn}, audience_type, release_state,
               available_from, available_until, updated_by_user_id
             ) values ($1, 'global', $2, $3, $4, $5)
             on conflict (${idColumn}) do update
             set audience_type = 'global',
                 release_state = excluded.release_state,
                 available_from = excluded.available_from,
                 available_until = excluded.available_until,
                 updated_by_user_id = excluded.updated_by_user_id`,
            [
              normalized.targetId,
              normalized.releaseState,
              normalized.availableFrom
                ? new Date(normalized.availableFrom)
                : null,
              normalized.availableUntil
                ? new Date(normalized.availableUntil)
                : null,
              reviewer.userId,
            ],
          );

        },
        { retryOnConflict: true },
      );
      return readAvailabilityDashboard(query);
    },
  };
}

async function readAvailabilityDashboard(
  query: DatabaseQueryExecutor,
): Promise<StudentContentAvailabilityDashboard> {
  const [topicRows, questionRows, eventRows] = await Promise.all([
    readDatabaseRows(
      query,
      `select
         t.id,
         t.title,
         t.is_active,
         case when t.is_active then 'published' else 'archived' end
           as publication_state,
         tsa.audience_type,
         tsa.release_state,
         tsa.available_from,
         tsa.available_until
       from topics t
       left join topic_student_availability tsa on tsa.topic_id = t.id
       order by t.sort_order, t.title, t.id`,
    ),
    readDatabaseRows(
      query,
      `select
         q.id,
         coalesce(display_version.snapshot_json ->> 'title', q.title) as title,
         coalesce(display_version.snapshot_json ->> 'topicId', q.topic_id)
           as topic_id,
         t.title as topic_title,
         case
           when q.record_state = 'archived' then 'archived'
           when q.published_version_id is not null then 'published'
           else 'unpublished'
         end as publication_state,
         qsa.audience_type,
         qsa.release_state,
         qsa.available_from,
         qsa.available_until
       from questions q
       join question_versions display_version
         on display_version.id = coalesce(
           q.published_version_id,
           q.working_version_id
         )
       join topics t
         on t.id = coalesce(
           display_version.snapshot_json ->> 'topicId',
           q.topic_id
         )
       left join question_student_availability qsa on qsa.question_id = q.id
       where exists (
         select 1
         from question_versions approved_version
         join question_version_lifecycle approved_lifecycle
           on approved_lifecycle.question_version_id = approved_version.id
         where approved_version.question_id = q.id
           and approved_lifecycle.state in (
             'approved', 'published', 'unpublished'
           )
       )
       order by t.sort_order, t.title, t.id, title, q.id`,
    ),
    readDatabaseRows(
      query,
      `select
         event.*,
         actor.display_name as actor_display_name
       from student_content_availability_events event
       join users actor on actor.id = event.actor_user_id
       order by event.occurred_at desc, event.id desc
       limit 50`,
    ),
  ]);
  const now = Date.now();

  return {
    assignmentScope: "global_only",
    auditEvents: (eventRows as AvailabilityEventRow[]).map(mapEvent),
    mode: "database",
    questions: (questionRows as AvailabilityTargetRow[]).map((row) =>
      mapTarget(row, "question", now),
    ),
    readOnly: false,
    topics: (topicRows as AvailabilityTargetRow[]).map((row) =>
      mapTarget(row, "topic", now),
    ),
  };
}

async function assertEligibleTarget(
  query: DatabaseQueryExecutor,
  input: ContentAvailabilityUpdateInput,
) {
  if (input.targetType === "topic") {
    const rows = await query(
      "select is_active from topics where id = $1 limit 1",
      [input.targetId],
    );
    if (!rows[0]) {
      throw new ContentAvailabilityNotFoundError("The syllabus topic was not found.");
    }
    if (input.releaseState === "published" && !rows[0].is_active) {
      throw new ContentAvailabilityValidationError(
        "Restore the archived syllabus topic before publishing its availability.",
      );
    }
    return;
  }

  const rows = await query(
    `select
       q.record_state,
       q.published_version_id,
       exists (
         select 1
         from question_versions qv
         join question_version_lifecycle qvl
           on qvl.question_version_id = qv.id
         where qv.question_id = q.id
           and qvl.state in ('approved', 'published', 'unpublished')
       ) as has_approved_version
     from questions q
     where q.id = $1
     limit 1`,
    [input.targetId],
  );
  const question = rows[0];
  if (!question) {
    throw new ContentAvailabilityNotFoundError("The question was not found.");
  }
  if (!question.has_approved_version) {
    throw new ContentAvailabilityValidationError(
      "Only a professor-approved question can receive a student availability rule.",
    );
  }
  if (
    input.releaseState === "published" &&
    (question.record_state === "archived" || !question.published_version_id)
  ) {
    throw new ContentAvailabilityValidationError(
      "Publish the approved immutable version in the question lifecycle before making it globally available.",
    );
  }
}

function normalizeAvailabilityInput(
  input: ContentAvailabilityUpdateInput,
): ContentAvailabilityUpdateInput {
  const targetId = input.targetId.trim();
  if (!targetId || targetId.length > 200) {
    throw new ContentAvailabilityValidationError(
      "A valid availability target is required.",
    );
  }
  if (!(["topic", "question"] as const).includes(input.targetType)) {
    throw new ContentAvailabilityValidationError(
      "Availability target type must be topic or question.",
    );
  }
  if (
    !(["published", "unpublished", "archived"] as const).includes(
      input.releaseState,
    )
  ) {
    throw new ContentAvailabilityValidationError(
      "Availability state must be published, unpublished, or archived.",
    );
  }
  const availableFrom = normalizeOptionalDate(input.availableFrom);
  const availableUntil = normalizeOptionalDate(input.availableUntil);
  if (
    input.releaseState !== "published" &&
    (availableFrom || availableUntil)
  ) {
    throw new ContentAvailabilityValidationError(
      "Only globally published availability can have a schedule.",
    );
  }
  if (
    availableFrom &&
    availableUntil &&
    availableUntil <= availableFrom
  ) {
    throw new ContentAvailabilityValidationError(
      "Availability end must be later than its start.",
    );
  }
  const reason = input.reason?.trim() || undefined;
  if (reason && (reason.length < 3 || reason.length > 240)) {
    throw new ContentAvailabilityValidationError(
      "Availability reason must be between 3 and 240 characters.",
    );
  }

  return {
    availableFrom,
    availableUntil,
    reason,
    releaseState: input.releaseState,
    requestId: input.requestId?.trim().slice(0, 200) || undefined,
    targetId,
    targetType: input.targetType,
  };
}

function normalizeOptionalDate(value?: string) {
  if (!value?.trim()) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new ContentAvailabilityValidationError(
      "Availability schedule values must be valid ISO dates.",
    );
  }
  return new Date(timestamp).toISOString();
}

function mapTarget(
  row: AvailabilityTargetRow,
  targetType: "topic" | "question",
  now: number,
): StudentContentAvailabilityTarget {
  const publicationState = row.publication_state;
  const releaseState = row.release_state ?? "published";
  const availableFrom = optionalIso(row.available_from);
  const availableUntil = optionalIso(row.available_until);

  return {
    audienceType: "global",
    availableFrom,
    availableUntil,
    effectiveAvailability: effectiveAvailability({
      availableFrom,
      availableUntil,
      now,
      publicationState,
      releaseState,
    }),
    id: String(row.id),
    publicationState,
    releaseState,
    targetType,
    title: String(row.title),
    topicId: row.topic_id ? String(row.topic_id) : undefined,
    topicTitle: row.topic_title ? String(row.topic_title) : undefined,
  };
}

function effectiveAvailability(input: {
  availableFrom?: string;
  availableUntil?: string;
  now: number;
  publicationState: StudentContentPublicationState;
  releaseState: StudentContentReleaseState;
}) {
  if (
    input.publicationState === "archived" ||
    input.releaseState === "archived"
  ) {
    return "archived" as const;
  }
  if (
    input.publicationState === "unpublished" ||
    input.releaseState === "unpublished"
  ) {
    return "unpublished" as const;
  }
  if (
    input.availableFrom &&
    Date.parse(input.availableFrom) > input.now
  ) {
    return "scheduled" as const;
  }
  if (
    input.availableUntil &&
    Date.parse(input.availableUntil) <= input.now
  ) {
    return "expired" as const;
  }
  return "available" as const;
}

function mapEvent(row: AvailabilityEventRow): StudentContentAvailabilityEvent {
  return {
    actorDisplayName: String(row.actor_display_name),
    actorUserId: String(row.actor_user_id),
    fromAvailableFrom: optionalIso(row.from_available_from),
    fromAvailableUntil: optionalIso(row.from_available_until),
    fromReleaseState: row.from_release_state,
    id: Number(row.id),
    occurredAt: new Date(row.occurred_at).toISOString(),
    reason: row.reason ?? undefined,
    requestId: row.request_id ?? undefined,
    targetId: String(row.target_id),
    targetType: row.target_type,
    toAvailableFrom: optionalIso(row.to_available_from),
    toAvailableUntil: optionalIso(row.to_available_until),
    toReleaseState: row.to_release_state,
  };
}

function optionalIso(value: unknown) {
  if (!(value instanceof Date) && typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
