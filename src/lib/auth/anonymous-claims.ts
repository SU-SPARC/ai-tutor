import "server-only";

import { createHash } from "node:crypto";

import {
  readDatabaseRows,
  runDatabaseTransaction,
  type DatabaseQueryExecutor,
} from "@/lib/data/database-executor";
import { queryPostgres } from "@/lib/data/postgres";

export type AnonymousClaimSource = "signed_cookie" | "legacy_local_storage";

export class AnonymousIdentityAlreadyClaimedError extends Error {
  constructor() {
    super(
      "This browser practice identity was already imported by another account.",
    );
    this.name = "AnonymousIdentityAlreadyClaimedError";
  }
}

export async function claimAnonymousIdentity(
  input: {
    anonymousId: string;
    source: AnonymousClaimSource;
    userId: string;
  },
  query: DatabaseQueryExecutor = queryPostgres,
) {
  const subjectHash = hashAnonymousSubject(input.anonymousId);

  return runDatabaseTransaction(query, async (transactionQuery) => {
    const existingRows = await readDatabaseRows(
      transactionQuery,
      `
        select claimed_by_user_id, migrated_session_count
        from anonymous_identity_claims
        where anonymous_subject_hash = $1
        for update
      `,
      [subjectHash],
    );
    const existing = existingRows[0];
    if (existing) {
      if (String(existing.claimed_by_user_id) !== input.userId) {
        throw new AnonymousIdentityAlreadyClaimedError();
      }
      return {
        alreadyClaimed: true,
        migratedSessionCount: Number(existing.migrated_session_count),
      };
    }

    const migratedRows = await transactionQuery(
      `
        update tutor_sessions
        set user_id = $2,
            anonymous_user_id = null,
            expires_at = null,
            updated_at = now()
        where anonymous_user_id = $1
          and user_id is null
        returning id
      `,
      [input.anonymousId, input.userId],
    );
    const migratedSessionCount = migratedRows.length;

    await transactionQuery(
      `
        insert into anonymous_identity_claims (
          anonymous_subject_hash,
          claimed_by_user_id,
          source,
          migrated_session_count
        )
        values ($1, $2, $3, $4)
      `,
      [subjectHash, input.userId, input.source, migratedSessionCount],
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
        values ($1, $1, 'auth.anonymous_progress_claimed', 'user', $1, $2::jsonb)
      `,
      [
        input.userId,
        JSON.stringify({ source: input.source, migratedSessionCount }),
      ],
    );

    return { alreadyClaimed: false, migratedSessionCount };
  });
}

export function hashAnonymousSubject(anonymousId: string) {
  return createHash("sha256").update(anonymousId).digest("hex");
}
