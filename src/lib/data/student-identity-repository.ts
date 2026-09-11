import "server-only";

import {
  assertAuthorization,
  type AnalyticsAuthorization,
} from "@/lib/auth/authorization";
import {
  ANALYTICS_STUDENT_SESSION_FILTER_SQL,
  STUDENT_KEY_SQL,
} from "@/lib/data/analytics-population";
import {
  readDatabaseRows,
  type DatabaseQueryExecutor,
} from "@/lib/data/database-executor";

/**
 * What the analytics population knows about who a pseudonym belongs to. The
 * provider subject is the only value that leaves this module, and it travels
 * to the identity lookup alone: no caller may return it to a client.
 */
export type StudentAccountLink =
  | { identityProvider: string; kind: "account"; subject: string }
  | { kind: "anonymous" }
  | { kind: "unlinked" };

type AccountLinkRow = {
  authenticated: boolean | null;
  external_subject: string | null;
  identity_provider: string | null;
};

/**
 * A student key is `sha256('user:' || users.id)`. The digest is not reversed
 * here — it is recomputed forwards over the sessions that already form the
 * analytics population, and the owner it matches is then joined to its own
 * account row. A key that belongs to no student in that population resolves to
 * nothing, so this cannot be used to probe accounts the analytics never list.
 */
const ACCOUNT_LINK_SQL = `
  with student_owners as (
    select distinct
      ${STUDENT_KEY_SQL} as student_key,
      s.user_id
    from tutor_sessions s
    where s.practice_context = 'published'
      and ${ANALYTICS_STUDENT_SESSION_FILTER_SQL}
  )
  select
    owners.user_id is not null as authenticated,
    account.identity_provider,
    account.external_subject
  from student_owners owners
  left join users account
    on account.id = owners.user_id
    and account.user_type = 'human'
  where owners.student_key = $1
  limit 1
`;

export function createDatabaseStudentIdentityRepository(
  query: DatabaseQueryExecutor,
) {
  return {
    async findAccountLink(
      authorization: AnalyticsAuthorization,
      studentKey: string,
    ): Promise<StudentAccountLink | undefined> {
      assertAuthorization(authorization, "professor");
      const rows = (await readDatabaseRows(query, ACCOUNT_LINK_SQL, [
        studentKey,
      ])) as AccountLinkRow[];
      const row = rows[0];

      if (!row) {
        return undefined;
      }

      if (!row.authenticated) {
        return { kind: "anonymous" };
      }

      if (!row.identity_provider || !row.external_subject) {
        return { kind: "unlinked" };
      }

      return {
        identityProvider: row.identity_provider,
        kind: "account",
        subject: row.external_subject,
      };
    },
  };
}

/**
 * Reuses the existing `audit_events` table rather than introducing a second
 * audit mechanism. The row records who looked, which pseudonym they looked at,
 * and what the lookup returned — never the name or the email address that was
 * shown, and never the provider subject.
 *
 * This deliberately does not swallow a write failure. A reveal discloses
 * personal data, so an unrecordable reveal must not happen at all: the caller
 * is expected to withhold the identity when this rejects.
 */
export async function recordStudentIdentityView(
  query: DatabaseQueryExecutor,
  input: {
    professorUserId: string;
    requestId?: string;
    status: string;
    studentKey: string;
  },
) {
  const rows = await query(
    `insert into audit_events (
       actor_user_id, actor_subject, action, entity_type, entity_id,
       outcome, request_id, metadata_json
     ) select
       case when exists (select 1 from users where id = $1) then $1 else null end,
       $1, 'analytics.student_identity_viewed', 'student_analytics', $2,
       'success', $3, $4::jsonb
     returning id`,
    [
      input.professorUserId,
      input.studentKey,
      input.requestId ?? null,
      JSON.stringify({ result: input.status }),
    ],
  );

  // A statement that reports no inserted row leaves no record either, and is
  // as much a failure here as a rejected query.
  if (!rows[0]) {
    throw new Error("The student identity view could not be recorded.");
  }
}
