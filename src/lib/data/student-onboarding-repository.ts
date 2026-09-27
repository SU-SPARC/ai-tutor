import "server-only";

import {
  readDatabaseRows,
  type DatabaseQueryExecutor,
} from "@/lib/data/database-executor";
import { queryPostgres } from "@/lib/data/postgres";
import { getOperatingModePolicy } from "@/lib/runtime/operating-mode";

/**
 * Demo storage for the acknowledgement: the user ids that acknowledged the
 * notice in this server process. It is used when the operating mode reads
 * from the demo repository (APP_DEMO_MODE, including ghost sign-in), and in
 * local database mode when Postgres cannot be reached, the same way tutor
 * sessions fall back to their in-memory store. It is lost on restart.
 */
const demoAcknowledgements = new Set<string>();

export function resetStudentOnboardingForTests() {
  demoAcknowledgements.clear();
}

type OnboardingStorage =
  | { kind: "demo" }
  | {
      kind: "database";
      query: DatabaseQueryExecutor;
      allowDemoFallback: boolean;
    };

/**
 * An explicit `query` (tests, scripts) always means the database. Otherwise
 * the operating mode decides: the demo repository keeps the flag in memory,
 * database modes use Postgres and fall back to memory only where the policy
 * allows it (local and test database modes, never staging or production).
 */
function storageFor(query: DatabaseQueryExecutor | undefined): OnboardingStorage {
  if (query) {
    return { kind: "database", query, allowDemoFallback: false };
  }
  const policy = getOperatingModePolicy();
  if (policy.repositorySource === "demo") {
    return { kind: "demo" };
  }
  return {
    kind: "database",
    query: queryPostgres,
    allowDemoFallback: policy.allowDemoFallback,
  };
}

export async function hasAcknowledgedStudentOnboarding(
  userId: string,
  query?: DatabaseQueryExecutor,
) {
  const storage = storageFor(query);
  if (storage.kind === "demo") {
    return demoAcknowledgements.has(userId);
  }

  try {
    const rows = await readDatabaseRows(
      storage.query,
      `
        select student_onboarding_acknowledged_at is not null as acknowledged
        from users
        where id = $1
          and user_type = 'human'
          and status = 'active'
        limit 1
      `,
      [userId],
    );

    return rows[0]?.acknowledged === true;
  } catch (cause) {
    if (storage.allowDemoFallback) {
      return demoAcknowledgements.has(userId);
    }
    throw cause;
  }
}

export async function acknowledgeStudentOnboarding(
  userId: string,
  query?: DatabaseQueryExecutor,
) {
  const storage = storageFor(query);
  if (storage.kind === "demo") {
    demoAcknowledgements.add(userId);
    return;
  }

  let rows: Record<string, unknown>[];
  try {
    rows = await storage.query(
      `
        update users
        set student_onboarding_acknowledged_at =
          coalesce(student_onboarding_acknowledged_at, now())
        where id = $1
          and user_type = 'human'
          and status = 'active'
        returning student_onboarding_acknowledged_at
      `,
      [userId],
    );
  } catch (cause) {
    if (storage.allowDemoFallback) {
      demoAcknowledgements.add(userId);
      return;
    }
    throw cause;
  }

  if (!rows[0]?.student_onboarding_acknowledged_at) {
    throw new Error("The active student account was not found.");
  }
}
