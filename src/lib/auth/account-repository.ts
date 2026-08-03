import "server-only";

import { randomUUID } from "node:crypto";

import {
  readDatabaseRows,
  runDatabaseTransaction,
  type DatabaseQueryExecutor,
} from "@/lib/data/database-executor";
import { queryPostgres } from "@/lib/data/postgres";

export const APPLICATION_ROLES = ["student", "professor", "admin"] as const;

export type ApplicationRole = (typeof APPLICATION_ROLES)[number];

export type ApplicationUserAccess = {
  displayName: string;
  email: string;
  id: string;
  roles: ApplicationRole[];
  sessionVersion: number;
  status: "active" | "deleted" | "disabled" | "invited";
};

export type OidcAccountInput = {
  displayName: string;
  email: string;
  issuer: string;
  subject: string;
};

export class IdentityConflictError extends Error {
  constructor() {
    super("The institutional identity conflicts with an existing account.");
    this.name = "IdentityConflictError";
  }
}

export async function upsertOidcAccount(
  input: OidcAccountInput,
  query: DatabaseQueryExecutor = queryPostgres,
): Promise<ApplicationUserAccess> {
  return runDatabaseTransaction(query, async (transactionQuery) => {
    const existingRows = await readDatabaseRows(
      transactionQuery,
      `
        select id
        from users
        where identity_provider = $1
          and external_subject = $2
        limit 1
        for update
      `,
      [input.issuer, input.subject],
    );
    const existing = existingRows[0];

    if (existing) {
      if (
        await findConflictingEmail(
          transactionQuery,
          input.email,
          String(existing.id),
        )
      ) {
        throw new IdentityConflictError();
      }

      await transactionQuery(
        `
          update users
          set email = $2,
              display_name = $3,
              status = case when status = 'invited' then 'active' else status end,
              last_login_at = now(),
              updated_at = now()
          where id = $1
        `,
        [String(existing.id), input.email, input.displayName],
      );

      return requireApplicationUserAccess(
        String(existing.id),
        transactionQuery,
      );
    }

    if (await findConflictingEmail(transactionQuery, input.email)) {
      throw new IdentityConflictError();
    }

    const userId = `user:${randomUUID()}`;
    await transactionQuery(
      `
        insert into users (
          id,
          identity_provider,
          external_subject,
          email,
          display_name,
          user_type,
          status,
          last_login_at
        )
        values ($1, $2, $3, $4, $5, 'human', 'active', now())
      `,
      [userId, input.issuer, input.subject, input.email, input.displayName],
    );
    await transactionQuery(
      `
        insert into user_roles (user_id, role_id, granted_by_user_id)
        values ($1, 'student', 'system:schema-migration')
      `,
      [userId],
    );
    await transactionQuery(
      `
        insert into audit_events (
          actor_user_id,
          actor_subject,
          action,
          entity_type,
          entity_id,
          metadata_json
        )
        values ($1, $1, 'auth.account_created', 'user', $1, $2::jsonb)
      `,
      [userId, JSON.stringify({ initialRole: "student" })],
    );

    return requireApplicationUserAccess(userId, transactionQuery);
  });
}

export async function getApplicationUserAccess(
  userId: string,
  query: DatabaseQueryExecutor = queryPostgres,
): Promise<ApplicationUserAccess | undefined> {
  const rows = await readDatabaseRows(
    query,
    `
      select
        u.id,
        u.email,
        u.display_name,
        u.status,
        u.session_version,
        coalesce(
          array_agg(ur.role_id order by ur.role_id)
            filter (
              where ur.revoked_at is null
                and (ur.expires_at is null or ur.expires_at > now())
            ),
          array[]::text[]
        ) as roles
      from users u
      left join user_roles ur on ur.user_id = u.id
      where u.id = $1
        and u.user_type = 'human'
      group by u.id
      limit 1
    `,
    [userId],
  );
  const row = rows[0];

  if (!row) {
    return undefined;
  }

  return {
    displayName: String(row.display_name),
    email: String(row.email),
    id: String(row.id),
    roles: stringArray(row.roles).filter(isApplicationRole),
    sessionVersion: Number(row.session_version),
    status: row.status as ApplicationUserAccess["status"],
  };
}

async function requireApplicationUserAccess(
  userId: string,
  query: DatabaseQueryExecutor,
) {
  const access = await getApplicationUserAccess(userId, query);

  if (!access) {
    throw new Error("The authenticated application account was not found.");
  }

  return access;
}

async function findConflictingEmail(
  query: DatabaseQueryExecutor,
  email: string,
  excludedUserId?: string,
) {
  const rows = await readDatabaseRows(
    query,
    `
      select id
      from users
      where lower(email) = lower($1)
        and deleted_at is null
        and ($2::text is null or id <> $2)
      limit 1
    `,
    [email, excludedUserId ?? null],
  );
  return Boolean(rows[0]);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function isApplicationRole(value: string): value is ApplicationRole {
  return (APPLICATION_ROLES as readonly string[]).includes(value);
}
