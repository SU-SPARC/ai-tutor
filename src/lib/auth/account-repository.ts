import "server-only";

import { randomUUID } from "node:crypto";

import {
  readDatabaseRows,
  runDatabaseTransaction,
  type DatabaseQueryExecutor,
} from "@/lib/data/database-executor";
import { queryPostgres } from "@/lib/data/postgres";
import type { ApplicationRole } from "@/lib/auth/roles";

export type ApplicationUserAccess = {
  displayName: string;
  email: string;
  id: string;
  sessionVersion: number;
  status: "active" | "deleted" | "disabled" | "invited";
};

export const CLERK_IDENTITY_PROVIDER = "clerk";

export type ClerkAccountInput = {
  clerkUserId: string;
  displayName: string;
  email: string;
};

export class IdentityConflictError extends Error {
  constructor() {
    super("The authenticated identity conflicts with an existing account.");
    this.name = "IdentityConflictError";
  }
}

export async function upsertClerkAccount(
  input: ClerkAccountInput,
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
      [CLERK_IDENTITY_PROVIDER, input.clerkUserId],
    );
    const existing = existingRows[0];

    if (existing) {
      return refreshExistingAccount(
        String(existing.id),
        input,
        transactionQuery,
      );
    }

    if (await findConflictingEmail(transactionQuery, input.email)) {
      throw new IdentityConflictError();
    }

    const userId = `user:${randomUUID()}`;
    const insertedRows = await transactionQuery(
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
        on conflict (identity_provider, external_subject) do nothing
        returning id
      `,
      [
        userId,
        CLERK_IDENTITY_PROVIDER,
        input.clerkUserId,
        input.email,
        input.displayName,
      ],
    );
    if (!insertedRows[0]?.id) {
      const concurrentRows = await readDatabaseRows(
        transactionQuery,
        `
          select id
          from users
          where identity_provider = $1
            and external_subject = $2
          limit 1
          for update
        `,
        [CLERK_IDENTITY_PROVIDER, input.clerkUserId],
      );
      const concurrentUserId = concurrentRows[0]?.id;
      if (!concurrentUserId) {
        throw new Error("The authenticated Clerk account could not be linked.");
      }
      return refreshExistingAccount(
        String(concurrentUserId),
        input,
        transactionQuery,
      );
    }
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
      [
        userId,
        JSON.stringify({
          identityProvider: CLERK_IDENTITY_PROVIDER,
          defaultAccess: "student",
        }),
      ],
    );

    return requireApplicationUserAccess(userId, transactionQuery);
  });
}

export async function getApplicationUserAccessByExternalIdentity(
  identityProvider: string,
  externalSubject: string,
  query: DatabaseQueryExecutor = queryPostgres,
): Promise<ApplicationUserAccess | undefined> {
  const rows = await readDatabaseRows(
    query,
    `
      select id
      from users
      where identity_provider = $1
        and external_subject = $2
        and user_type = 'human'
      limit 1
    `,
    [identityProvider, externalSubject],
  );
  const userId = rows[0]?.id;

  return userId ? getApplicationUserAccess(String(userId), query) : undefined;
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
        u.session_version
      from users u
      where u.id = $1
        and u.user_type = 'human'
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
    sessionVersion: Number(row.session_version),
    status: row.status as ApplicationUserAccess["status"],
  };
}

export async function syncClerkRoleProjection(
  userId: string,
  role: ApplicationRole,
  query: DatabaseQueryExecutor = queryPostgres,
) {
  return runDatabaseTransaction(query, async (transactionQuery) => {
    await transactionQuery(
      `
        insert into user_roles (user_id, role_id, granted_by_user_id)
        values ($1, 'student', 'system:schema-migration')
        on conflict (user_id, role_id) do update
        set revoked_at = null,
            revoked_by_user_id = null,
            expires_at = null,
            updated_at = now()
        where user_roles.revoked_at is not null
           or user_roles.expires_at is not null
      `,
      [userId],
    );

    if (role === "professor") {
      await transactionQuery(
        `
          insert into user_roles (user_id, role_id, granted_by_user_id)
          values ($1, 'professor', 'system:schema-migration')
          on conflict (user_id, role_id) do update
          set revoked_at = null,
              revoked_by_user_id = null,
              expires_at = null,
              updated_at = now()
          where user_roles.revoked_at is not null
             or user_roles.expires_at is not null
        `,
        [userId],
      );
    } else {
      await transactionQuery(
        `
          update user_roles
          set revoked_at = now(),
              revoked_by_user_id = 'system:schema-migration',
              updated_at = now()
          where user_id = $1
            and role_id = 'professor'
            and revoked_at is null
        `,
        [userId],
      );
    }
  });
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

async function refreshExistingAccount(
  userId: string,
  input: ClerkAccountInput,
  query: DatabaseQueryExecutor,
) {
  if (await findConflictingEmail(query, input.email, userId)) {
    throw new IdentityConflictError();
  }

  await query(
    `
      update users
      set email = $2,
          display_name = $3,
          status = case when status = 'invited' then 'active' else status end,
          last_login_at = now(),
          updated_at = now()
      where id = $1
    `,
    [userId, input.email, input.displayName],
  );

  return requireApplicationUserAccess(userId, query);
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
