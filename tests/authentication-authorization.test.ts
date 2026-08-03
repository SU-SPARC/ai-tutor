import { afterEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";

import {
  signAnonymousCookie,
  verifyAnonymousCookie,
} from "@/lib/auth/anonymous-session";
import { authorizeApiRole } from "@/lib/auth/principal";
import {
  AnonymousIdentityAlreadyClaimedError,
  claimAnonymousIdentity,
} from "@/lib/auth/anonymous-claims";
import {
  IdentityConflictError,
  upsertOidcAccount,
} from "@/lib/auth/account-repository";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import { createMemoryTutorSessionRepository } from "@/lib/data/tutor-session-repository";
import { parseServerEnv } from "@/lib/env/server";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_ADMIN,
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

    expect(env.AUTH_ENABLED).toBe(false);
    expect(env.AUTH_OIDC_ENABLED).toBe(false);
    expect(env.AUTH_TEST_MODE).toBe(false);
  });

  it("rejects partial OIDC configuration", () => {
    expect(() =>
      parseServerEnv({
        NODE_ENV: "development",
        AUTH_ISSUER_URL: "https://identity.example.edu",
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          "AUTH_CLIENT_ID is required.",
          "AUTH_CLIENT_SECRET is required.",
          "AUTH_SESSION_SECRET is required.",
        ]),
      }),
    );
  });

  it("preserves the institution-supplied issuer exactly", () => {
    const env = parseServerEnv({
      NODE_ENV: "development",
      AUTH_CLIENT_ID: "local-client",
      AUTH_CLIENT_SECRET: "local-client-secret",
      AUTH_ISSUER_URL: "https://identity.example.edu/tenant/",
      AUTH_SESSION_SECRET: "local-session-secret-at-least-32-characters",
    });

    expect(env.AUTH_ISSUER_URL).toBe("https://identity.example.edu/tenant/");
    expect(env.AUTH_OIDC_ENABLED).toBe(true);
  });

  it("permits fixed local test identities only with a strong session secret", () => {
    const env = parseServerEnv({
      NODE_ENV: "test",
      AUTH_TEST_MODE: "true",
      AUTH_SESSION_SECRET: "local-test-session-secret-at-least-32-characters",
    });

    expect(env.AUTH_ENABLED).toBe(true);
    expect(env.AUTH_TEST_MODE).toBe(true);

    expect(() =>
      parseServerEnv({
        APP_ENV: "preview",
        APP_URL: "https://preview.example.edu",
        ANONYMOUS_PILOT_ENABLED: "false",
        AUTH_TEST_MODE: "true",
        AUTH_SESSION_SECRET: "local-test-session-secret-at-least-32-characters",
      }),
    ).toThrowError(/AUTH_TEST_MODE must not be enabled/);
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

  it("rejects an insecure issuer in a deployed preview", () => {
    expect(() =>
      parseServerEnv({
        APP_ENV: "preview",
        APP_URL: "https://preview.example.edu",
        ANONYMOUS_PILOT_ENABLED: "false",
        AUTH_CLIENT_ID: "preview-client",
        AUTH_CLIENT_SECRET: "preview-client-secret",
        AUTH_ISSUER_URL: "http://identity.example.edu",
        AUTH_SESSION_SECRET: "preview-session-secret-at-least-32-characters",
      }),
    ).toThrowError(/AUTH_ISSUER_URL must use https/);
  });
});

describe("session authorization", () => {
  it("distinguishes missing authentication, insufficient role, and allowed roles", async () => {
    mockPrincipal(undefined);
    const missing = await authorizeApiRole("professor");
    mockPrincipal(TEST_STUDENT);
    const student = await authorizeApiRole("professor");
    mockPrincipal(TEST_PROFESSOR);
    const professor = await authorizeApiRole("professor");
    mockPrincipal(TEST_ADMIN);
    const inheritedProfessor = await authorizeApiRole("professor");

    expect(missing.ok ? 200 : missing.response.status).toBe(401);
    expect(student.ok ? 200 : student.response.status).toBe(403);
    expect(professor.ok).toBe(true);
    expect(inheritedProfessor.ok).toBe(true);
  });

  it("never links different OIDC subjects by matching email", async () => {
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
      create table user_roles (
        user_id text not null,
        role_id text not null,
        granted_by_user_id text,
        revoked_at timestamptz,
        expires_at timestamptz,
        primary key (user_id, role_id)
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

    const first = await upsertOidcAccount(
      {
        displayName: "First Identity",
        email: "duplicate@example.edu",
        issuer: "https://identity.example.edu",
        subject: "subject-a",
      },
      query,
    );

    await expect(
      upsertOidcAccount(
        {
          displayName: "Second Identity",
          email: "duplicate@example.edu",
          issuer: "https://identity.example.edu",
          subject: "subject-b",
        },
        query,
      ),
    ).rejects.toBeInstanceOf(IdentityConflictError);

    expect(first.roles).toEqual(["student"]);
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
