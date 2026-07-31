import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import {
  IntegrityWorkflowError,
  assertIntegrityDatabaseTarget,
  auditDatabaseIntegrity,
  formatIntegrityReport,
  repairDatabaseIntegrity,
  runReadOnlyIntegrityAudit,
} from "../scripts/lib/database-integrity.mjs";
import type { MigrationClient } from "../scripts/lib/database-migrations.mjs";
import {
  loadMigrations,
  runPendingMigrations,
} from "../scripts/lib/database-migrations.mjs";
import { parseArguments } from "../scripts/database-integrity.mjs";

const openDatabases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(
    openDatabases.splice(0).map((database) => database.close()),
  );
});

describe("production data integrity", () => {
  it("runs all ten checks in a repeatable-read, read-only audit and formats a human report", async () => {
    const database = await integrityDatabase("test");
    const report = await runReadOnlyIntegrityAudit(clientFor(database), {
      target: "test",
    });

    expect(report).toMatchObject({
      mode: "audit",
      readOnly: true,
      status: "clean",
      summary: {
        failedChecks: 0,
        findings: 0,
        passedChecks: 10,
        totalChecks: 10,
      },
      target: "test",
    });
    expect(formatIntegrityReport(report)).toContain(
      "Database integrity audit: clean",
    );
    expect(formatIntegrityReport(report)).toContain(
      "[PASS] Broken question-topic relationships: 0",
    );

    await database.query(
      "insert into topics (id, sort_order) values ('after-audit', 1)",
    );
    const topics = await database.query<{ count: number }>(
      "select count(*)::int as count from topics",
    );
    expect(topics.rows[0].count).toBe(1);
  });

  it("reports every requested corruption class without changing records", async () => {
    const database = await integrityDatabase("staging");
    await seedEveryIntegrityViolation(database);
    const before = await snapshotCorruptData(database);

    const report = await runReadOnlyIntegrityAudit(clientFor(database), {
      target: "production",
    });

    expect(
      new Set(
        report.checks
          .filter((check) => check.count > 0)
          .map((check) => check.id),
      ),
    ).toEqual(
      new Set([
        "broken_question_topic_relationships",
        "missing_solution_steps",
        "duplicate_question_ids",
        "invalid_publication_states",
        "approved_questions_without_reviewer_history",
        "generated_drafts_student_visible",
        "topic_order_conflicts",
        "orphaned_tutor_sessions",
        "impossible_usage_counts",
        "test_demo_records_in_production",
      ]),
    );
    expect(check(report, "duplicate_question_ids").sampleIds).toContain(
      "duplicate-id",
    );
    expect(check(report, "generated_drafts_student_visible").sampleIds).toEqual(
      expect.arrayContaining([
        "question:generated-draft",
        "retrieval:generated-retrieval-draft",
      ]),
    );
    expect(
      check(report, "generated_drafts_student_visible").repairAction,
    ).toBeNull();
    expect(check(report, "test_demo_records_in_production").sampleIds).toEqual(
      expect.arrayContaining([
        "content_import:demo-release",
        "schema_migration:1",
        "session:orphan-session",
      ]),
    );
    expect(formatIntegrityReport(report)).toContain(
      "Repair: report-only; owner decision required",
    );
    expect(await snapshotCorruptData(database)).toEqual(before);
  });

  it("binds the requested target to the immutable migration ledger", async () => {
    const database = await integrityDatabase("staging");

    await expect(
      assertIntegrityDatabaseTarget(clientFor(database), "production"),
    ).rejects.toThrow(/does not match migration-ledger target/i);
    await expect(
      assertIntegrityDatabaseTarget(clientFor(database), "staging"),
    ).resolves.toBeUndefined();
  });

  it("requires explicit repair authorization before any database query", async () => {
    const noQueryClient: MigrationClient = {
      query: async () => {
        throw new Error("database must not be queried");
      },
    };
    const base = {
      actions: ["quarantine-unsafe-questions"] as const,
      actorUserId: "professor-1",
      changeTicket: "DATA-91",
      target: "test" as const,
    };

    await expect(
      repairDatabaseIntegrity(noQueryClient, {
        ...base,
        actions: [...base.actions],
      }),
    ).rejects.toThrow(/explicit confirmation/i);
    await expect(
      repairDatabaseIntegrity(noQueryClient, {
        ...base,
        actions: [...base.actions],
        confirmRepair: true,
        target: "production",
      }),
    ).rejects.toThrow(/confirm-production/i);
    await expect(
      repairDatabaseIntegrity(noQueryClient, {
        ...base,
        actions: ["unsupported-action" as never],
        confirmRepair: true,
      }),
    ).rejects.toBeInstanceOf(IntegrityWorkflowError);
  });

  it("repairs only explicitly selected reversible cases and records the ticket", async () => {
    const database = await integrityDatabase("test");
    await seedRepairableViolations(database);

    const report = await repairDatabaseIntegrity(clientFor(database), {
      actions: ["quarantine-unsafe-questions", "reconcile-usage-totals"],
      actorUserId: "professor-1",
      changeTicket: "DATA-91",
      confirmRepair: true,
      target: "test",
    });

    expect(report.status).toBe("repaired");
    expect(report.before.summary.findings).toBeGreaterThan(0);
    expect(report.after.summary.findings).toBe(0);
    expect(report.actions).toEqual([
      expect.objectContaining({
        action: "quarantine-unsafe-questions",
        changedRows: 1,
      }),
      expect.objectContaining({
        action: "reconcile-usage-totals",
        changedRows: 3,
      }),
    ]);

    const question = await database.query<{
      review_notes: string;
      review_status: string;
      reviewed_by_user_id: string;
      visibility: string;
    }>(`
      select visibility, review_status, reviewed_by_user_id, review_notes
      from questions where id = 'unsafe-question'
    `);
    expect(question.rows[0]).toMatchObject({
      review_status: "needs_edit",
      reviewed_by_user_id: "professor-1",
      visibility: "private",
    });
    expect(question.rows[0].review_notes).toContain("DATA-91");

    const totals = await database.query<{
      ai_total: number;
      reservation_total: number;
      session_total: number;
    }>(`
      select
        (select llm_total_tokens from ai_usage limit 1)::int as ai_total,
        (select actual_total_tokens from ai_llm_reservations limit 1)::int as reservation_total,
        (select llm_total_tokens from tutor_sessions limit 1)::int as session_total
    `);
    expect(totals.rows[0]).toEqual({
      ai_total: 12,
      reservation_total: 9,
      session_total: 7,
    });

    const events = await database.query<{
      action: string;
      count: number;
      metadata: Array<{ changeTicket: string }>;
    }>(`
      select
        min(action) as action,
        count(*)::int as count,
        jsonb_agg(metadata_json order by id) as metadata
      from audit_events
    `);
    expect(events.rows[0].action).toBe("database_integrity_repair");
    expect(events.rows[0].count).toBe(2);
    expect(events.rows[0].metadata).toEqual([
      expect.objectContaining({ changeTicket: "DATA-91" }),
      expect.objectContaining({ changeTicket: "DATA-91" }),
    ]);
    expect(formatIntegrityReport(report)).toContain("Pre-repair findings:");
  });

  it("rolls back all changes if repair audit recording fails", async () => {
    const database = await integrityDatabase("test");
    await seedRepairableViolations(database);
    await database.exec(`
      alter table audit_events
      add constraint reject_integrity_repair check (
        action <> 'database_integrity_repair'
      )
    `);

    await expect(
      repairDatabaseIntegrity(clientFor(database), {
        actions: ["quarantine-unsafe-questions"],
        actorUserId: "professor-1",
        changeTicket: "DATA-ROLLBACK",
        confirmRepair: true,
        target: "test",
      }),
    ).rejects.toThrow();

    const result = await database.query<{
      count: number;
      review_status: string;
      visibility: string;
    }>(`
      select
        min(visibility) as visibility,
        min(review_status) as review_status,
        count(*)::int as count
      from questions where id = 'unsafe-question'
    `);
    expect(result.rows[0]).toEqual({
      count: 1,
      review_status: "approved",
      visibility: "public",
    });
  });

  it("audits and quarantines through the complete production schema and its review triggers", async () => {
    const database = new PGlite();
    openDatabases.push(database);
    const client = clientFor(database);
    const migrations = await loadMigrations(
      path.join(process.cwd(), "db/migrations"),
    );
    await runPendingMigrations({
      actor: "integrity-test",
      client,
      deploymentSha: "integrity-test-sha",
      migrations,
      target: "test",
    });
    await database.query(`
      insert into users (
        id, identity_provider, external_subject, email, display_name,
        user_type, status
      ) values (
        'professor-integrity', 'university', 'professor-integrity',
        'professor.integrity@example.edu', 'Professor Integrity',
        'human', 'active'
      )
    `);
    await database.query(`
      insert into user_roles (
        user_id, role_id, granted_by_user_id
      ) values (
        'professor-integrity', 'professor', 'system:schema-migration'
      )
    `);
    await database.query(
      "select set_config('app.current_user_id', 'professor-integrity', false)",
    );
    await database.query(`
      insert into topics (id, title, description, sort_order)
      values ('integrity-topic', 'Integrity topic', '', 1)
    `);
    await database.query(`
      insert into questions (
        id, topic_id, title, prompt, difficulty, accepted_answers_json,
        numeric_value, tolerance, answer_explanation, source_type,
        trust_level, review_status, visibility, originality_note,
        reviewed_by, reviewed_by_user_id, reviewed_at
      ) values (
        'integrity-question', 'integrity-topic', 'Integrity question',
        'What is one?', 'foundational', '["1"]'::jsonb,
        1, 0, 'One is one.', 'professor_provided', 'public_original',
        'approved', 'public', 'Institution-authored test fixture.',
        'Professor Integrity', 'professor-integrity', now()
      )
    `);

    const before = await runReadOnlyIntegrityAudit(client, { target: "test" });
    expect(check(before, "missing_solution_steps").sampleIds).toEqual([
      "integrity-question",
    ]);

    const repair = await repairDatabaseIntegrity(client, {
      actions: ["quarantine-unsafe-questions"],
      actorUserId: "professor-integrity",
      changeTicket: "DATA-INTEGRATION-91",
      confirmRepair: true,
      target: "test",
    });
    expect(repair.after.status).toBe("clean");

    const result = await database.query<{
      decision: string;
      review_status: string;
      visibility: string;
    }>(`
      select
        q.visibility,
        q.review_status,
        latest.decision
      from questions q
      cross join lateral (
        select qah.decision
        from question_approval_history qah
        where qah.question_id = q.id
        order by qah.id desc
        limit 1
      ) latest
      where q.id = 'integrity-question'
    `);
    expect(result.rows[0]).toEqual({
      decision: "needs_edit",
      review_status: "needs_edit",
      visibility: "private",
    });
  });

  it("keeps audit as the default CLI and makes repair opt-in", async () => {
    expect(parseArguments(["--target", "test"])).toMatchObject({
      actions: [],
      mode: "audit",
      target: "test",
    });
    expect(() =>
      parseArguments([
        "repair",
        "--target",
        "test",
        "--action",
        "quarantine-unsafe-questions",
      ]),
    ).toThrow(/confirm-repair/i);
    expect(
      parseArguments([
        "repair",
        "--target",
        "production",
        "--action",
        "reconcile-usage-totals",
        "--confirm-repair",
        "--confirm-production",
      ]),
    ).toMatchObject({
      actions: ["reconcile-usage-totals"],
      confirmProduction: true,
      confirmRepair: true,
      mode: "repair",
    });
    expect(() =>
      parseArguments(["audit", "--target", "test", "--confirm-repair"]),
    ).toThrow(/not accepted in read-only audit mode/i);

    const packageJson = JSON.parse(await readFile("package.json", "utf8"));
    expect(packageJson.scripts["db:integrity"]).toBe(
      "node scripts/database-integrity.mjs",
    );
  });
});

function check(
  report: Awaited<ReturnType<typeof auditDatabaseIntegrity>>,
  id: string,
) {
  const result = report.checks.find((candidate) => candidate.id === id);
  if (!result) {
    throw new Error(`Missing integrity check ${id}`);
  }
  return result;
}

async function integrityDatabase(target: "production" | "staging" | "test") {
  const database = new PGlite();
  openDatabases.push(database);
  await database.exec(`
    create table schema_migrations (
      version integer,
      target text
    );
    insert into schema_migrations (version, target) values (1, '${target}');

    create table approved_content_imports (
      release_id text,
      target text
    );
    create table topics (
      id text,
      sort_order integer
    );
    create table questions (
      id text,
      topic_id text,
      title text,
      source_type text,
      trust_level text,
      review_status text,
      visibility text,
      reviewed_by text,
      reviewed_by_user_id text,
      reviewed_at timestamptz,
      archived_at timestamptz,
      review_notes text,
      updated_at timestamptz default now()
    );
    create table solution_steps (
      question_id text,
      step_order integer,
      body text
    );
    create table hints (
      question_id text,
      hint_order integer,
      body text
    );
    create table question_approval_history (
      question_id text,
      decision text,
      reviewer_user_id text,
      decided_at timestamptz
    );
    create table retrieval_chunks (
      id text,
      source_type text,
      trust_level text,
      review_status text,
      visibility text
    );
    create view app_public_questions as
      select id from questions where visibility = 'public';
    create view app_student_retrieval_chunks as
      select id from retrieval_chunks where visibility = 'public';

    create table users (
      id text,
      identity_provider text,
      external_subject text,
      email text,
      display_name text,
      user_type text,
      status text
    );
    create table user_roles (
      user_id text,
      role_id text,
      revoked_at timestamptz,
      expires_at timestamptz
    );
    create table tutor_sessions (
      id text,
      user_id text,
      anonymous_user_id text,
      question_id text,
      revealed_hints integer default 0,
      revealed_steps integer default 0,
      llm_calls integer default 0,
      llm_input_tokens integer default 0,
      llm_output_tokens integer default 0,
      llm_total_tokens integer default 0,
      updated_at timestamptz default now()
    );
    create table attempts (
      id bigserial,
      estimated_tokens integer
    );
    create table student_progress (
      id bigserial,
      attempts_count integer,
      hints_revealed integer,
      steps_revealed integer
    );
    create table ai_usage (
      scope text,
      scope_key text,
      date_key date,
      interactions integer,
      estimated_tokens integer,
      llm_fallbacks integer,
      llm_input_tokens integer,
      llm_output_tokens integer,
      llm_total_tokens integer,
      estimated_llm_tokens integer,
      cache_hits integer,
      limit_blocks integer,
      updated_at timestamptz default now()
    );
    create table ai_llm_reservations (
      id text,
      reserved_total_tokens integer,
      actual_input_tokens integer,
      actual_output_tokens integer,
      actual_total_tokens integer,
      status text,
      updated_at timestamptz default now()
    );
    create table audit_events (
      id bigserial,
      actor_user_id text,
      actor_subject text not null,
      action text not null,
      entity_type text not null,
      entity_id text not null,
      outcome text not null,
      metadata_json jsonb not null
    );
  `);
  return database;
}

async function seedEveryIntegrityViolation(database: PGlite) {
  await database.exec(`
    insert into approved_content_imports (release_id, target)
    values ('demo-release', 'development');
    insert into topics (id, sort_order) values
      ('topic-a', 1),
      ('topic-b', 1),
      ('topic-negative', -1);
    insert into users (
      id, identity_provider, external_subject, email, display_name, user_type, status
    ) values
      ('professor-1', 'university', 'professor-1', 'professor@example.edu', 'Professor One', 'human', 'active'),
      ('fake-student', 'fixture', 'test-student', 'fake@example.edu', 'Demo Student', 'human', 'active');

    insert into questions (
      id, topic_id, title, source_type, trust_level, review_status,
      visibility, reviewed_by_user_id, reviewed_at
    ) values
      ('broken-topic', 'missing-topic', 'Broken topic', 'professor_provided', 'public_original', 'needs_review', 'private', null, null),
      ('missing-step', 'topic-a', 'Missing solution', 'professor_provided', 'public_original', 'approved', 'public', 'professor-1', '2026-01-01T00:00:00Z'),
      ('duplicate-id', 'topic-a', 'Duplicate one', 'professor_provided', 'public_original', 'needs_review', 'private', null, null),
      ('duplicate-id', 'topic-a', 'Duplicate two', 'professor_provided', 'public_original', 'needs_review', 'private', null, null),
      ('invalid-publication', 'topic-a', 'Invalid publication', 'professor_provided', 'generated_unverified', 'approved', 'public', null, null),
      ('no-history', 'topic-a', 'No history', 'professor_provided', 'public_original', 'approved', 'public', 'professor-1', '2026-01-02T00:00:00Z'),
      ('generated-draft', 'topic-a', 'Generated draft', 'generated_original', 'generated_unverified', 'needs_review', 'public', null, null),
      ('demo-question', 'topic-a', 'Demo fixture question', 'original_demo', 'public_original', 'needs_review', 'private', 'system:schema-migration', null);
    insert into solution_steps (question_id, step_order, body)
    values ('no-history', 1, 'A valid step.');
    insert into question_approval_history (
      question_id, decision, reviewer_user_id, decided_at
    ) values (
      'missing-step', 'approved', 'professor-1', '2026-01-01T00:00:00Z'
    );
    insert into retrieval_chunks (
      id, source_type, trust_level, review_status, visibility
    ) values (
      'generated-retrieval-draft', 'generated_original',
      'generated_unverified', 'needs_review', 'public'
    );

    insert into tutor_sessions (
      id, anonymous_user_id, question_id, llm_input_tokens,
      llm_output_tokens, llm_total_tokens
    ) values ('orphan-session', 'demo-student', 'missing-question', 2, 3, 99);
    insert into ai_usage (
      scope, scope_key, date_key, interactions, estimated_tokens,
      llm_fallbacks, llm_input_tokens, llm_output_tokens, llm_total_tokens,
      estimated_llm_tokens, cache_hits, limit_blocks
    ) values ('global', 'global', current_date, 1, 1, 0, 2, 4, 99, 0, 0, 0);
    insert into attempts (estimated_tokens) values (-1);
    insert into student_progress (
      attempts_count, hints_revealed, steps_revealed
    ) values (-1, 0, 0);
    insert into ai_llm_reservations (
      id, reserved_total_tokens, actual_input_tokens, actual_output_tokens,
      actual_total_tokens, status
    ) values ('bad-reservation', 10, 1, 0, 1, 'pending');
    insert into audit_events (
      actor_subject, action, entity_type, entity_id, outcome, metadata_json
    ) values ('fixture-operator', 'seed', 'database', 'production', 'success', '{}'::jsonb);
  `);
}

async function seedRepairableViolations(database: PGlite) {
  await database.exec(`
    insert into topics (id, sort_order) values ('topic-a', 1);
    insert into users (
      id, identity_provider, external_subject, email, display_name, user_type, status
    ) values (
      'professor-1', 'university', 'professor-1',
      'professor@example.edu', 'Professor One', 'human', 'active'
    );
    insert into user_roles (user_id, role_id)
    values ('professor-1', 'professor');
    insert into questions (
      id, topic_id, title, source_type, trust_level, review_status,
      visibility, reviewed_by, reviewed_by_user_id, reviewed_at
    ) values (
      'unsafe-question', 'topic-a', 'Unsafe question', 'professor_provided',
      'public_original', 'approved', 'public', 'Professor One',
      'professor-1', '2026-01-01T00:00:00Z'
    );
    insert into tutor_sessions (
      id, anonymous_user_id, question_id, llm_input_tokens,
      llm_output_tokens, llm_total_tokens
    ) values ('session-1', 'anonymous-1', 'unsafe-question', 3, 4, 88);
    insert into ai_usage (
      scope, scope_key, date_key, interactions, estimated_tokens,
      llm_fallbacks, llm_input_tokens, llm_output_tokens, llm_total_tokens,
      estimated_llm_tokens, cache_hits, limit_blocks
    ) values ('global', 'global', current_date, 1, 1, 0, 5, 7, 88, 0, 0, 0);
    insert into ai_llm_reservations (
      id, reserved_total_tokens, actual_input_tokens, actual_output_tokens,
      actual_total_tokens, status
    ) values ('reservation-1', 10, 4, 5, 88, 'settled');
  `);
}

async function snapshotCorruptData(database: PGlite) {
  const result = await database.query<{
    audit_events: number;
    question_rows: number;
    usage_total: number;
  }>(`
    select
      (select count(*)::int from questions) as question_rows,
      (select min(llm_total_tokens)::int from ai_usage) as usage_total,
      (select count(*)::int from audit_events) as audit_events
  `);
  return result.rows[0];
}

function clientFor(database: PGlite): MigrationClient {
  return {
    exec(sql) {
      return database.exec(sql);
    },
    async query(sql, params = []) {
      const result =
        params.length > 0
          ? await database.query(sql, params as never[])
          : await database.query(sql);
      return { rows: result.rows as Array<Record<string, unknown>> };
    },
  };
}
