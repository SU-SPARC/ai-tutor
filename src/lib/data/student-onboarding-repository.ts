import "server-only";

import {
  readDatabaseRows,
  type DatabaseQueryExecutor,
} from "@/lib/data/database-executor";
import { queryPostgres } from "@/lib/data/postgres";

export async function hasAcknowledgedStudentOnboarding(
  userId: string,
  query: DatabaseQueryExecutor = queryPostgres,
) {
  const rows = await readDatabaseRows(
    query,
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
}

export async function acknowledgeStudentOnboarding(
  userId: string,
  query: DatabaseQueryExecutor = queryPostgres,
) {
  const rows = await query(
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

  if (!rows[0]?.student_onboarding_acknowledged_at) {
    throw new Error("The active student account was not found.");
  }
}
