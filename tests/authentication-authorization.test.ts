import { afterEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";

import {
  signAnonymousCookie,
  verifyAnonymousCookie,
} from "@/lib/auth/anonymous-session";
import { authorizeApi, requireProfessor } from "@/lib/auth/authorization";
import {
  AnonymousIdentityAlreadyClaimedError,
  claimAnonymousIdentity,
} from "@/lib/auth/anonymous-claims";
import {
  IdentityConflictError,
  upsertClerkAccount,
} from "@/lib/auth/account-repository";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import { createMemoryTutorSessionRepository } from "@/lib/data/tutor-session-repository";
import { parseServerEnv } from "@/lib/env/server";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
  TEST_STUDENT,
} from "./auth-test-helpers";

afterEach(() => {
  resetAuthMocks();
  vi.unstubAllEnvs();
});

describe("authentication configuration", () => {
  it("is explicitly unconfigured in local development without credentials", () => {
    const env = parseServerEnv({ NODE_ENV: "development" });

    expect(env.CLERK_ENABLED).toBe(false);
  });

  it("rejects partial Clerk configuration", () => {
    expect(() =>
      parseServerEnv({
        NODE_ENV: "development",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: clerkKey("publishable", "test"),
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining(["CLERK_SECRET_KEY is required."]),
      }),
    );
  });

  it("enables Clerk only when both server and browser keys are configured", () => {
    const env = parseServerEnv({
      NODE_ENV: "development",
      CLERK_SECRET_KEY: clerkKey("secret", "test"),
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: clerkKey("publishable", "test"),
    });

    expect(env.CLERK_ENABLED).toBe(true);
  });

  it("rejects the removed local identity selector in deployed environments", () => {
    expect(() =>
      parseServerEnv({
        APP_ENV: "preview",
        APP_URL: "https://preview.example.edu",
        ANONYMOUS_PILOT_ENABLED: "false",
        AUTH_TEST_MODE: "true",
      }),
    ).toThrowError(/AUTH_TEST_MODE is no longer supported/);
  });

  it("rejects legacy admin secrets in deployed environments", () => {
    expect(() =>
      parseServerEnv({
        APP_ENV: "preview",
        APP_URL: "https://preview.example.edu",
        ANONYMOUS_PILOT_ENABLED: "false",
        ADMIN_SECRET: "shared-browser-secret",
      }),
    ).toThrowError(/ADMIN_SECRET is no longer supported/);
  });

  it("rejects legacy admin secrets locally too", () => {
    expect(() =>
      parseServerEnv({
        ADMIN_SECRET: "obsolete-local-value",
        NODE_ENV: "development",
      }),
    ).toThrowError(/ADMIN_SECRET is no longer supported/);
  });

  it("does not enable authentication from legacy OIDC variables", () => {
    const env = parseServerEnv({
      AUTH_CLIENT_ID: "unused",
      AUTH_CLIENT_SECRET: "unused",
      AUTH_ISSUER_URL: "https://identity.example.edu",
      NODE_ENV: "development",
    });

    expect(env.CLERK_ENABLED).toBe(false);
  });
});

describe("session authorization", () => {
  it("distinguishes missing authentication, insufficient role, and allowed roles", async () => {
    mockPrincipal(undefined);
    const missing = await authorizeApi(requireProfessor);
    mockPrincipal(TEST_STUDENT);
    const student = await authorizeApi(requireProfessor);
    mockPrincipal(TEST_PROFESSOR);
    const professor = await authorizeApi(requireProfessor);
    mockPrincipal(TEST_PROFESSOR);
    const inheritedProfessor = await authorizeApi(requireProfessor);

    expect(missing.ok ? 200 : missing.response.status).toBe(401);
    expect(student.ok ? 200 : student.response.status).toBe(403);
    expect(professor.ok).toBe(true);
    expect(inheritedProfessor.ok).toBe(true);
  });

  it("never links different Clerk users by matching email", async () => {
    const database = new PGlite();
    await database.exec(`
      create table users (
        id text primary key,
        identity_provider text not null,
        external_subject text not null,
        email text,
        display_name text not null,
        user_type text not null,
        status text not null,
        session_version integer not null default 1,
        last_login_at timestamptz,
        deleted_at timestamptz,
        updated_at timestamptz not null default now(),
        unique (identity_provider, external_subject)
      );
      create table audit_events (
        id bigserial primary key,
        actor_user_id text,
        actor_subject text not null,
        action text not null,
        entity_type text not null,
        entity_id text,
        metadata_json jsonb not null
      );
    `);
    const query: DatabaseQueryExecutor = async (sql, params = []) => {
      const result = await database.query<Record<string, unknown>>(sql, params);
      return result.rows;
    };

    const first = await upsertClerkAccount(
      {
        clerkUserId: "user_clerk_subject_a",
        displayName: "First Identity",
        email: "duplicate@example.edu",
      },
      query,
    );
    const repeated = await upsertClerkAccount(
      {
        clerkUserId: "user_clerk_subject_a",
        displayName: "First Identity Updated",
        email: "duplicate@example.edu",
      },
      query,
    );

    await expect(
      upsertClerkAccount(
        {
          clerkUserId: "user_clerk_subject_b",
          displayName: "Second Identity",
          email: "duplicate@example.edu",
        },
        query,
      ),
    ).rejects.toBeInstanceOf(IdentityConflictError);

    expect(repeated).toMatchObject({
      displayName: "First Identity Updated",
      id: first.id,
    });
    const stored = await database.query<{
      external_subject: string;
      identity_provider: string;
    }>("select identity_provider, external_subject from users where id = $1", [
      first.id,
    ]);
    expect(stored.rows[0]).toEqual({
      external_subject: "user_clerk_subject_a",
      identity_provider: "clerk",
    });
    const accountCreatedAudits = await database.query<{ count: number }>(
      "select count(*)::int as count from audit_events where action = 'auth.account_created'",
    );
    expect(accountCreatedAudits.rows[0].count).toBe(1);
    await database.close();
  });
});

describe("anonymous ownership", () => {
  it("rejects forged and expired cookies", () => {
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv(
      "ANONYMOUS_ID_SECRET",
      "test-anonymous-signing-secret-at-least-32-characters",
    );
    const valid = signAnonymousCookie(
      "anon:11111111-1111-4111-8111-111111111111",
      new Date(Date.now() + 60_000),
    );
    const forged = `${valid.slice(0, -1)}x`;
    const expired = signAnonymousCookie(
      "anon:22222222-2222-4222-8222-222222222222",
      new Date(Date.now() - 60_000),
    );

    expect(verifyAnonymousCookie(valid)).toBe(
      "anon:11111111-1111-4111-8111-111111111111",
    );
    expect(verifyAnonymousCookie(forged)).toBeUndefined();
    expect(verifyAnonymousCookie(expired)).toBeUndefined();
  });

  it("returns no session for a different owner even when its ID is known", async () => {
    const repository = createMemoryTutorSessionRepository();
    const ownerA = { kind: "anonymous" as const, anonymousId: "anon:owner-a" };
    const ownerB = { kind: "anonymous" as const, anonymousId: "anon:owner-b" };
    const session = await repository.createSession({
      owner: ownerA,
      questionId: "dice-sum-eight",
    });

    await expect(
      repository.getSession(session.id, ownerB),
    ).resolves.toBeUndefined();
    await expect(
      repository.revealHint(session.id, ownerB),
    ).resolves.toBeUndefined();
    await expect(
      repository.recordAttempt({ owner: ownerB, sessionId: session.id }),
    ).resolves.toBeUndefined();
    await expect(
      repository.getSession(session.id, ownerA),
    ).resolves.toMatchObject({
      attempts: [],
      revealedHints: 0,
    });
  });

  it("claims sessions atomically, idempotently, and for only one account", async () => {
    const database = new PGlite();
    await database.exec(`
      create table tutor_sessions (
        id text primary key,
        anonymous_user_id text,
        user_id text,
        expires_at timestamptz,
        updated_at timestamptz not null default now()
      );
      create table anonymous_identity_claims (
        anonymous_subject_hash text primary key,
        claimed_by_user_id text not null,
        source text not null,
        migrated_session_count integer not null,
        claimed_at timestamptz not null default now()
      );
      create table audit_events (
        id bigserial primary key,
        actor_user_id text,
        actor_subject text not null,
        action text not null,
        entity_type text not null,
        entity_id text,
        metadata_json jsonb not null
      );
      insert into tutor_sessions (id, anonymous_user_id)
      values ('session-a', 'anon:claim-once');
    `);
    const query: DatabaseQueryExecutor = async (sql, params = []) => {
      const result = await database.query<Record<string, unknown>>(sql, params);
      return result.rows;
    };

    const first = await claimAnonymousIdentity(
      {
        anonymousId: "anon:claim-once",
        source: "signed_cookie",
        userId: "user:destination-a",
      },
      query,
    );
    const repeated = await claimAnonymousIdentity(
      {
        anonymousId: "anon:claim-once",
        source: "signed_cookie",
        userId: "user:destination-a",
      },
      query,
    );

    await expect(
      claimAnonymousIdentity(
        {
          anonymousId: "anon:claim-once",
          source: "signed_cookie",
          userId: "user:destination-b",
        },
        query,
      ),
    ).rejects.toBeInstanceOf(AnonymousIdentityAlreadyClaimedError);

    const sessions = await database.query<{
      anonymous_user_id: string | null;
      user_id: string | null;
    }>("select anonymous_user_id, user_id from tutor_sessions");
    const audits = await database.query<{ count: number }>(
      "select count(*)::int as count from audit_events",
    );

    expect(first).toEqual({ alreadyClaimed: false, migratedSessionCount: 1 });
    expect(repeated).toEqual({ alreadyClaimed: true, migratedSessionCount: 1 });
    expect(sessions.rows[0]).toEqual({
      anonymous_user_id: null,
      user_id: "user:destination-a",
    });
    expect(audits.rows[0].count).toBe(1);
    await database.close();
  });
});

function clerkKey(
  kind: "publishable" | "secret",
  environment: "live" | "test",
) {
  const prefix = kind === "publishable" ? `${"p"}k` : `${"s"}k`;
  return `${prefix}_${environment}_${"unit-test".repeat(4)}`;
}
