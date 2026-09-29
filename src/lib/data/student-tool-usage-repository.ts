import "server-only";

import {
  assertAuthorization,
  ownerFromAuthorization,
  type StudentAuthorization,
} from "@/lib/auth/authorization";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import { queryPostgres } from "@/lib/data/postgres";

export const SKETCHPAD_ACTIVITY_BUCKET_SECONDS = 15;
const SKETCHPAD_ACTIVITY_BUCKET_MS = SKETCHPAD_ACTIVITY_BUCKET_SECONDS * 1_000;

export type AiHelpRequestContext = {
  eventId: string;
  questionId: string;
  questionVersionId: number;
  sessionId: string;
  topicId: string;
};

export type UsageRecordOutcome =
  | "anonymous"
  | "duplicate"
  | "ineligible"
  | "recorded";

/**
 * Floors a server receipt time to the fixed activity bucket. The browser never
 * supplies this value or a duration, so one request can credit at most one
 * 15-second interval regardless of how late or malformed it is.
 */
export function sketchpadActivityBucketStart(receivedAt: Date) {
  return new Date(
    Math.floor(receivedAt.getTime() / SKETCHPAD_ACTIVITY_BUCKET_MS) *
      SKETCHPAD_ACTIVITY_BUCKET_MS,
  );
}

export function createStudentToolUsageRepository(
  query: DatabaseQueryExecutor = queryPostgres,
) {
  return {
    async recordAiHelpRequest(
      authorization: StudentAuthorization,
      context: AiHelpRequestContext,
    ): Promise<UsageRecordOutcome> {
      assertAuthorization(authorization, "student");
      const owner = ownerFromAuthorization(authorization);
      if (owner.kind !== "user") return "anonymous";
      if (authorization.principal?.role !== "student") return "ineligible";

      const rows = await query(
        `
          insert into student_usage_events (
            user_id,
            event_type,
            idempotency_key,
            tutor_session_id,
            question_id,
            question_version_id,
            topic_id
          )
          values ($1, 'ai_help_click', $2, $3, $4, $5, $6)
          on conflict (user_id, event_type, idempotency_key) do nothing
          returning id
        `,
        [
          owner.userId,
          context.eventId,
          context.sessionId,
          context.questionId,
          context.questionVersionId,
          context.topicId,
        ],
      );

      return rows.length > 0 ? "recorded" : "duplicate";
    },

    async recordSketchpadHeartbeat(
      authorization: StudentAuthorization,
      receivedAt = new Date(),
    ): Promise<UsageRecordOutcome> {
      assertAuthorization(authorization, "student");
      const owner = ownerFromAuthorization(authorization);
      if (owner.kind !== "user") return "anonymous";
      if (authorization.principal?.role !== "student") return "ineligible";

      const rows = await query(
        `
          insert into student_tool_active_buckets (
            user_id,
            tool,
            bucket_started_at,
            credited_seconds
          )
          values ($1, 'sketchpad', $2, ${SKETCHPAD_ACTIVITY_BUCKET_SECONDS})
          on conflict (user_id, tool, bucket_started_at) do nothing
          returning bucket_started_at
        `,
        [owner.userId, sketchpadActivityBucketStart(receivedAt)],
      );

      return rows.length > 0 ? "recorded" : "duplicate";
    },
  };
}

type StudentToolUsageRepository = ReturnType<
  typeof createStudentToolUsageRepository
>;

let repositoryOverride: StudentToolUsageRepository | undefined;

function repository() {
  return repositoryOverride ?? createStudentToolUsageRepository();
}

export function recordAiHelpRequest(
  authorization: StudentAuthorization,
  context: AiHelpRequestContext,
) {
  return repository().recordAiHelpRequest(authorization, context);
}

export function recordSketchpadHeartbeat(
  authorization: StudentAuthorization,
  receivedAt?: Date,
) {
  return repository().recordSketchpadHeartbeat(authorization, receivedAt);
}

export function setStudentToolUsageRepositoryForTests(
  nextRepository?: StudentToolUsageRepository,
) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Usage repository injection is restricted to tests.");
  }
  repositoryOverride = nextRepository;
}
