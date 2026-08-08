import "server-only";

import type { AuthenticatedPrincipal } from "@/lib/auth/principal";
import { queryPostgres } from "@/lib/data/postgres";
import { getServerEnv } from "@/lib/env/server";

export async function recordQuestionLifecycleApiAttempt(input: {
  action?: string;
  errorName?: string;
  outcome: "denied" | "failure";
  principal?: AuthenticatedPrincipal;
  questionId?: string;
  requestId: string;
  versionId?: number;
}) {
  const env = getServerEnv();
  if (env.APP_DEMO_MODE || !env.DATABASE_URL) {
    return;
  }

  const actorSubject = input.principal?.userId ?? "anonymous";
  try {
    await queryPostgres(
      `insert into audit_events (
        actor_user_id, actor_subject, action, entity_type, entity_id,
        outcome, request_id, metadata_json
      )
      select
        case when exists (select 1 from users where id = $1) then $1 else null end,
        $2,
        'question_lifecycle.' || coalesce(nullif($3, ''), 'transition_attempt'),
        'question',
        $4,
        $5,
        $6,
        $7::jsonb`,
      [
        input.principal?.userId ?? null,
        actorSubject,
        input.action ?? null,
        input.questionId ?? null,
        input.outcome,
        input.requestId,
        JSON.stringify({
          errorName: input.errorName?.slice(0, 120),
          questionVersionId: input.versionId,
        }),
      ],
    );
  } catch {
    // An unavailable audit store must not replace the original authorization or
    // lifecycle error, and no request content is retained as a fallback.
  }
}
