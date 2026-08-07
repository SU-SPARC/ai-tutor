import { readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import { createDatabaseContentRepository } from "@/lib/data/database-repository";
import {
  DatabaseOperationError,
  POSTGRES_RUNTIME_DEFAULTS,
  classifyPostgresError,
  queryPostgres,
  retrySafePostgresOperation,
  setPostgresPoolForTests,
} from "@/lib/data/postgres";
import { createDatabaseTutorSessionRepository } from "@/lib/data/tutor-session-repository";
import { requireProfessorReview } from "@/lib/auth/authorization";
import { mockPrincipal, resetAuthMocks } from "./auth-test-helpers";

const openDatabases: PGlite[] = [];

afterEach(async () => {
  resetAuthMocks();
  setPostgresPoolForTests(undefined);
  vi.unstubAllEnvs();
  await Promise.all(
    openDatabases.splice(0).map((database) => database.close()),
  );
});

describe("production database reliability", () => {
  it("bounds each serverless instance and configures finite database timeouts", () => {
    expect(POSTGRES_RUNTIME_DEFAULTS).toMatchObject({
      connectionTimeoutMs: 5_000,
      idleInTransactionTimeoutMs: 10_000,
      lockTimeoutMs: 2_000,
      maxConnectionsPerInstance: 4,
      queryTimeoutMs: 8_000,
      statementTimeoutMs: 7_000,
    });
  });

  it("classifies failed connections without retaining SQL or credentials", () => {
    const connectionUrl = "postgres://student:secret@private.example.edu/tutor";
    const sql = "select * from professor_private_answers";
    const classified = classifyPostgresError(
      Object.assign(new Error(`${connectionUrl}: ${sql}`), {
        code: "ECONNREFUSED",
      }),
    );

    expect(classified).toBeInstanceOf(DatabaseOperationError);
    expect(classified).toMatchObject({
      category: "unavailable",
      code: "DATABASE_OPERATION_FAILED",
      retryable: true,
    });
    expect(`${classified.message}\n${classified.stack}`).not.toContain(
      connectionUrl,
    );
    expect(`${classified.message}\n${classified.stack}`).not.toContain(sql);
  });

  it("retries an explicitly safe transient read but not a constraint failure", async () => {
    let transientAttempts = 0;
    const value = await retrySafePostgresOperation(async () => {
      transientAttempts += 1;
      if (transientAttempts === 1) {
        throw Object.assign(new Error("connection reset"), {
          code: "ECONNRESET",
        });
      }
      return "recovered";
    });
    let constraintAttempts = 0;

    await expect(
      retrySafePostgresOperation(async () => {
        constraintAttempts += 1;
        throw Object.assign(new Error("duplicate"), { code: "23505" });
      }),
    ).rejects.toMatchObject({
      category: "constraint",
      retryable: false,
    });

    expect(value).toBe("recovered");
    expect(transientAttempts).toBe(2);
    expect(constraintAttempts).toBe(1);
  });

  it("commits successful work and rolls back failed work on one client", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://runtime:test@db.example.test/tutor");
    const statements: string[] = [];
    const client = {
      async query(sql: string) {
        statements.push(sql.replace(/\s+/g, " ").trim().toLowerCase());
        return { rows: [] };
      },
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn(async () => client),
    } as unknown as Pool;
    setPostgresPoolForTests(pool);

    await queryPostgres.transaction!(async (query) => {
      await query("update tutor_sessions set last_seen_at = now()");
    });

    expect(statements).toEqual([
      "begin",
      "update tutor_sessions set last_seen_at = now()",
      "commit",
    ]);
    expect(client.release).toHaveBeenLastCalledWith(false);

    statements.length = 0;
    await expect(
      queryPostgres.transaction!(async (query) => {
        await query("update questions set review_status = 'approved'");
        throw Object.assign(new Error("constraint details"), { code: "23514" });
      }),
    ).rejects.toMatchObject({ category: "constraint" });
    expect(statements).toEqual([
      "begin",
      "update questions set review_status = 'approved'",
      "rollback",
    ]);
  });

  it("allows only one of two simultaneous review decisions to win", async () => {
    const database = createDatabase();
    await createReviewSchema(database);
    const executor = pgliteExecutor(database);
    const repository = createDatabaseContentRepository(
      "postgres://not-used.invalid/reliability-test",
      executor,
    );
    mockPrincipal({
      displayName: "Primary professor",
      email: "primary@example.invalid",
      kind: "user",
      role: "professor",
      roles: ["student", "professor"],
      userId: "professor:primary",
    });
    const primaryAuthorization = await requireProfessorReview();
    mockPrincipal({
      displayName: "Backup professor",
      email: "backup@example.invalid",
      kind: "user",
      role: "professor",
      roles: ["student", "professor"],
      userId: "professor:backup",
    });
    const backupAuthorization = await requireProfessorReview();

    const [approval, rejection] = await Promise.all([
      repository
        .updateReviewCandidates(primaryAuthorization, {
          action: "approve",
          candidateIds: ["concurrent-review"],
        })
        .then((items) => items[0]),
      repository
        .updateReviewCandidates(backupAuthorization, {
          action: "reject",
          candidateIds: ["concurrent-review"],
        })
        .then((items) => items[0]),
    ]);
    const winners = [approval, rejection].filter(Boolean);
    const final = await database.query<{
      review_status: string;
      reviewed_by_user_id: string;
    }>(
      `select review_status, reviewed_by_user_id
       from questions
       where id = 'concurrent-review'`,
    );

    expect(winners).toHaveLength(1);
    expect(final.rows).toHaveLength(1);
    expect(["approved", "rejected"]).toContain(final.rows[0].review_status);
    expect(["professor:primary", "professor:backup"]).toContain(
      final.rows[0].reviewed_by_user_id,
    );
    expect(winners[0]?.review.status).toBe(final.rows[0].review_status);
  });

  it("preserves every simultaneous tutor write for one session", async () => {
    const database = createDatabase();
    await createTutorSchema(database);
    const repository = createDatabaseTutorSessionRepository(
      "postgres://not-used.invalid/reliability-test",
      pgliteExecutor(database),
    );
    const owner = {
      kind: "anonymous" as const,
      anonymousId: "anon:concurrency-test",
    };
    const session = await repository.createSession({
      owner,
      questionId: "question-1",
    });

    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        repository.revealHint(session.id, owner),
      ),
    );
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        repository.recordAttempt({
          answerPreview: `attempt ${index + 1}`,
          owner,
          sessionId: session.id,
        }),
      ),
    );
    const final = await repository.getSession(session.id, owner);

    expect(results.every(Boolean)).toBe(true);
    expect(final?.revealedHints).toBe(12);
    expect(final?.attempts).toHaveLength(8);
  });
});

function createDatabase() {
  const database = new PGlite();
  openDatabases.push(database);
  return database;
}

function pgliteExecutor(database: PGlite): DatabaseQueryExecutor {
  let transactionTail = Promise.resolve();
  const query: DatabaseQueryExecutor = async (sql, params = []) => {
    const result = await database.query<Record<string, unknown>>(sql, params);
    return result.rows;
  };
  query.read = query;
  query.transaction = async (work) => {
    const previous = transactionTail;
    let releaseTransaction!: () => void;
    transactionTail = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    await previous;

    try {
      // PGlite has one in-process connection. Serializing the callback models
      // the per-row ordering PostgreSQL provides to these transactions while
      // still issuing the competing repository calls simultaneously.
      return await work(query);
    } finally {
      releaseTransaction();
    }
  };
  return query;
}

async function createReviewSchema(database: PGlite) {
  for (const migration of [
    "001_initial_schema.sql",
    "002_tutor_session_progress.sql",
    "003_retrieval_chunks.sql",
    "004_llm_usage_controls.sql",
    "005_professor_admin_workflow.sql",
    "006_syllabus_topic_order.sql",
    "007_production_schema_hardening.sql",
    "008_approved_content_import.sql",
  ]) {
    await database.exec(
      readFileSync(
        path.join(process.cwd(), "db/migrations", migration),
        "utf8",
      ),
    );
  }

  await database.exec(`
    insert into topics (id, title, description, sort_order, week_number, module_ref)
    values ('topic-1', 'Topic 1', 'Reliability test topic', 1, 1, 'T1');

    insert into users (
      id,
      identity_provider,
      external_subject,
      email,
      display_name
    ) values
      (
        'professor:primary',
        'institutional-test',
        'primary',
        'primary@example.test',
        'Primary professor'
      ),
      (
        'professor:backup',
        'institutional-test',
        'backup',
        'backup@example.test',
        'Backup professor'
      );

    insert into user_roles (user_id, role_id, granted_by_user_id)
    values
      ('professor:primary', 'professor', 'system:schema-migration'),
      ('professor:backup', 'professor', 'system:schema-migration');

    insert into questions (
      id,
      topic_id,
      title,
      prompt,
      difficulty,
      accepted_answers_json,
      answer_explanation,
      source_type,
      trust_level,
      visibility,
      review_status,
      review_priority
    ) values (
      'concurrent-review',
      'topic-1',
      'Concurrent review',
      'A public-safe generated question.',
      'foundational',
      '["answer"]'::jsonb,
      'A public-safe explanation.',
      'generated_original',
      'generated_unverified',
      'public',
      'needs_review',
      'priority'
    );
  `);
}

async function createTutorSchema(database: PGlite) {
  await database.exec(`
    create table tutor_sessions (
      id text primary key,
      anonymous_user_id text,
      user_id text,
      question_id text not null,
      expires_at timestamptz,
      revealed_hints integer not null default 0,
      revealed_steps integer not null default 0,
      created_at timestamptz not null default now(),
      last_seen_at timestamptz not null default now()
    );

    create table attempts (
      id bigserial primary key,
      session_id text not null,
      question_id text not null,
      mode text not null,
      answer_preview text,
      source text,
      verdict text,
      estimated_tokens integer not null,
      created_at timestamptz not null default now()
    );
  `);
}
