import "server-only";

import {
  assertAuthorization,
  type AnalyticsAuthorization,
} from "@/lib/auth/authorization";
import {
  ANALYTICS_STUDENT_SESSION_FILTER_SQL,
  STUDENT_ACCOUNTS_CTE,
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
  student_key: string;
};

/**
 * A student key is `sha256('user:' || users.id)`. The digest is not reversed
 * here — it is recomputed forwards over the same population the Students page
 * lists: signed-in student accounts, and the owners of the sessions that form
 * the practice analytics. The owner it matches is then joined to its own
 * account row. A key that belongs to no student in that population resolves to
 * nothing, so this cannot be used to probe accounts the Students page never
 * lists — professor accounts, system actors, and disabled or deleted accounts
 * among them. One statement serves both the single reveal and the roster
 * reveal: the keys arrive as an array, and each matched owner comes back once.
 */
const ACCOUNT_LINKS_SQL = `
  with
  ${STUDENT_ACCOUNTS_CTE},
  student_owners as (
    select
      ${STUDENT_KEY_SQL} as student_key,
      s.user_id
    from tutor_sessions s
    where s.practice_context = 'published'
      and ${ANALYTICS_STUDENT_SESSION_FILTER_SQL}
    union
    select student_key, user_id
    from student_accounts
  )
  select
    owners.student_key,
    owners.user_id is not null as authenticated,
    account.identity_provider,
    account.external_subject
  from student_owners owners
  left join users account
    on account.id = owners.user_id
    and account.user_type = 'human'
  where owners.student_key = any($1::text[])
`;

function toAccountLink(row: AccountLinkRow): StudentAccountLink {
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
}

async function readAccountLinks(
  query: DatabaseQueryExecutor,
  studentKeys: string[],
) {
  const links = new Map<string, StudentAccountLink>();

  if (studentKeys.length === 0) {
    return links;
  }

  const rows = (await readDatabaseRows(query, ACCOUNT_LINKS_SQL, [
    studentKeys,
  ])) as AccountLinkRow[];

  for (const row of rows) {
    if (!links.has(row.student_key)) {
      links.set(row.student_key, toAccountLink(row));
    }
  }

  return links;
}

export function createDatabaseStudentIdentityRepository(
  query: DatabaseQueryExecutor,
) {
  return {
    async findAccountLink(
      authorization: AnalyticsAuthorization,
      studentKey: string,
    ): Promise<StudentAccountLink | undefined> {
      assertAuthorization(authorization, "professor");
      return (await readAccountLinks(query, [studentKey])).get(studentKey);
    },

    /**
     * The roster's counterpart to `findAccountLink`: one read for every key
     * on the page. A key outside the population is simply absent from the
     * result, exactly as the single lookup resolves it to nothing.
     */
    async findAccountLinks(
      authorization: AnalyticsAuthorization,
      studentKeys: string[],
    ): Promise<Map<string, StudentAccountLink>> {
      assertAuthorization(authorization, "professor");
      return readAccountLinks(query, [...new Set(studentKeys)]);
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

/**
 * The roster reveal's audit record: one `analytics.student_identity_viewed`
 * row per student, written in a single statement so a roster is either
 * recorded in full or not at all. Each row carries the same fields as a
 * single reveal plus `scope: "roster"`, so an auditor can tell a reveal of
 * everyone from a reveal of one. As with the single reveal, a statement that
 * inserts fewer rows than it was given is a failure, and the caller is
 * expected to withhold every identity when this rejects.
 */
export async function recordStudentIdentityViews(
  query: DatabaseQueryExecutor,
  input: {
    professorUserId: string;
    requestId?: string;
    views: Array<{ status: string; studentKey: string }>;
  },
) {
  if (input.views.length === 0) {
    return;
  }

  const rows = await query(
    `insert into audit_events (
       actor_user_id, actor_subject, action, entity_type, entity_id,
       outcome, request_id, metadata_json
     ) select
       case when exists (select 1 from users where id = $1) then $1 else null end,
       $1, 'analytics.student_identity_viewed', 'student_analytics',
       view.student_key, 'success', $2,
       jsonb_build_object('result', view.status, 'scope', 'roster')
     from unnest($3::text[], $4::text[]) as view(student_key, status)
     returning id`,
    [
      input.professorUserId,
      input.requestId ?? null,
      input.views.map((view) => view.studentKey),
      input.views.map((view) => view.status),
    ],
  );

  if (rows.length !== input.views.length) {
    throw new Error("The student identity views could not be recorded.");
  }
}
