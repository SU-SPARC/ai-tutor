import "server-only";

import type { AuthenticatedPrincipal } from "@/lib/auth/principal";
import { queryPostgres } from "@/lib/data/postgres";
import { getServerEnv } from "@/lib/env/server";

export async function recordContentTransferApiAttempt(input: {
  action: "export" | "import" | "preview";
  errorName?: string;
  outcome: "denied" | "failure";
  principal?: AuthenticatedPrincipal;
  requestId: string;
}) {
  const env = getServerEnv();
  if (env.APP_DEMO_MODE || !env.DATABASE_URL) return;
  try {
    await queryPostgres(
      `insert into audit_events (
        actor_user_id, actor_subject, action, entity_type, entity_id,
        outcome, request_id, metadata_json
      ) select
        case when exists (select 1 from users where id = $1) then $1 else null end,
        $2, 'content_transfer.' || $3, 'content_transfer', $4,
        $5, $4, $6::jsonb`,
      [
        input.principal?.userId ?? null,
        input.principal?.userId ?? "anonymous",
        input.action,
        input.requestId,
        input.outcome,
        JSON.stringify({ errorName: input.errorName?.slice(0, 120) }),
      ],
    );
  } catch {
    // Audit availability must not replace the original authorization or import error.
  }
}
