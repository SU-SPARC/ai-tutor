import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migrationDirectory = path.join(process.cwd(), "db/migrations");
const migrationFiles = readdirSync(migrationDirectory)
  .filter((file) => file.endsWith(".sql"))
  .sort();

const openDatabases: PGlite[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    openDatabases.splice(0).map((database) => database.close()),
  );
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("production schema hardening migration", () => {
  it("applies the complete migration chain to an empty Postgres database", async () => {
    const database = await migratedDatabase();

    const tableNames = await columnValues(
      database,
      `
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_type = 'BASE TABLE'
        order by table_name
      `,
      "table_name",
    );

    expect(tableNames).toEqual(
      expect.arrayContaining([
        "ai_usage",
        "anonymous_identity_claims",
        "approved_content_imports",
        "attempts",
        "audit_events",
        "feedback_reports",
        "hints",
        "misconceptions",
        "question_approval_history",
        "question_patterns",
        "question_versions",
        "questions",
        "roles",
        "solution_steps",
        "student_progress",
        "topics",
        "tutor_sessions",
        "user_roles",
        "users",
      ]),
    );

    const constraintNames = await columnValues(
      database,
      `
        select conname
        from pg_constraint
        where connamespace = 'public'::regnamespace
        order by conname
      `,
      "conname",
    );

    expect(constraintNames).toEqual(
      expect.arrayContaining([
        "ai_llm_reservations_session_fkey",
        "ai_usage_counts_nonnegative",
        "attempts_question_topic_fkey",
        "attempts_question_version_fkey",
        "audit_events_metadata_object",
        "feedback_reports_question_version_fkey",
        "hints_order_positive",
        "misconceptions_metadata_object",
        "question_approval_history_version_fkey",
        "question_patterns_no_private_source_signals",
        "questions_pattern_id_fkey",
        "questions_publication_state_check",
        "solution_steps_order_positive",
        "student_progress_question_topic_fkey",
        "student_progress_question_version_fkey",
        "topics_sort_order_unique",
        "tutor_sessions_identity_check",
        "users_human_email_required",
        "users_session_version_positive",
      ]),
    );

    const indexNames = await columnValues(
      database,
      `
        select indexname
        from pg_indexes
        where schemaname = 'public'
        order by indexname
      `,
      "indexname",
    );

    expect(indexNames).toEqual(
      expect.arrayContaining([
        "ai_usage_reporting_idx",
        "anonymous_identity_claims_user_idx",
        "attempts_question_activity_idx",
        "attempts_session_timeline_idx",
        "attempts_topic_activity_idx",
        "audit_events_entity_idx",
        "feedback_reports_professor_queue_idx",
        "hints_question_idx",
        "misconceptions_question_idx",
        "question_approval_history_question_idx",
        "question_patterns_topic_idx",
        "question_versions_question_created_idx",
        "questions_professor_queue_idx",
        "questions_professor_catalog_idx",
        "questions_review_work_queue_idx",
        "questions_student_publication_idx",
        "solution_steps_question_idx",
        "student_progress_student_topic_idx",
        "tutor_sessions_user_activity_idx",
        "tutor_sessions_anonymous_activity_idx",
        "user_roles_active_role_idx",
        "users_active_email_unique_idx",
      ]),
    );

    const mutableTablesWithUpdatedAt = await columnValues(
      database,
      `
        select table_name
        from information_schema.columns
        where table_schema = 'public'
          and column_name = 'updated_at'
          and table_name in (
            'users',
            'roles',
            'user_roles',
            'topics',
            'questions',
            'hints',
            'solution_steps',
            'misconceptions',
            'tutor_sessions',
            'attempts',
            'student_progress',
            'ai_usage',
            'ai_response_cache',
            'ai_llm_reservations',
            'retrieval_chunks',
            'feedback_reports'
          )
        order by table_name
      `,
      "table_name",
    );
    expect(mutableTablesWithUpdatedAt).toHaveLength(16);

    const deletionRules = await database.query<{
      confdeltype: string;
      conname: string;
    }>(`
      select conname, confdeltype
      from pg_constraint
      where conname in (
        'questions_topic_id_fkey',
        'question_versions_question_id_fkey',
        'tutor_sessions_user_id_fkey',
        'tutor_sessions_question_id_fkey',
        'attempts_session_id_fkey',
        'student_progress_user_id_fkey',
        'audit_events_actor_user_id_fkey',
        'feedback_reports_reporter_user_id_fkey',
        'ai_llm_reservations_session_fkey'
      )
      order by conname
    `);
    expect(
      Object.fromEntries(
        deletionRules.rows.map((row) => [row.conname, row.confdeltype]),
      ),
    ).toEqual({
      ai_llm_reservations_session_fkey: "c",
      attempts_session_id_fkey: "c",
      audit_events_actor_user_id_fkey: "n",
      feedback_reports_reporter_user_id_fkey: "n",
      question_versions_question_id_fkey: "r",
      questions_topic_id_fkey: "r",
      student_progress_user_id_fkey: "c",
      tutor_sessions_question_id_fkey: "n",
      tutor_sessions_user_id_fkey: "c",
    });

    const seededRoles = await columnValues(
      database,
      "select id from roles order by id",
      "id",
    );
    expect(seededRoles).toEqual(["admin", "professor", "student"]);
  });

  it("accepts the public development seed without bypassing review identity", async () => {
    const database = await migratedDatabase();
    const temporaryDirectory = mkdtempSync(
      path.join(tmpdir(), "pf-xj-schema-seed-"),
    );
    temporaryDirectories.push(temporaryDirectory);
    const outputPath = path.join(temporaryDirectory, "seed.sql");

    execFileSync(
      process.execPath,
      [
        path.join(process.cwd(), "scripts/prepare-public-db-seed.mjs"),
        "--output",
        outputPath,
      ],
      { stdio: "pipe" },
    );
    await database.exec(readFileSync(outputPath, "utf8"));

    const counts = await database.query<{
      approvals: number;
      public_questions: number;
      questions: number;
      topics: number;
    }>(`
      select
        (select count(*)::int from topics) as topics,
        (select count(*)::int from questions) as questions,
        (select count(*)::int from app_public_questions) as public_questions,
        (select count(*)::int from question_approval_history) as approvals
    `);

    expect(counts.rows[0]).toEqual({
      approvals: 8,
      public_questions: 8,
      questions: 8,
      topics: 11,
    });

    const latestVersion = await database.query<{ snapshot_json: unknown }>(`
      select snapshot_json
      from question_versions
      where question_id = 'demo-basic-probability-colored-tickets'
      order by version_number desc
      limit 1
    `);
    const snapshot = latestVersion.rows[0]?.snapshot_json as {
      hints: Array<{ body: string; order: number }>;
      solutionSteps: Array<{ body: string; order: number }>;
    };
    expect(snapshot.hints).toHaveLength(3);
    expect(snapshot.hints[0]).toEqual({
      body: "First find the total number of tickets.",
      order: 1,
    });
    expect(snapshot.solutionSteps).toHaveLength(3);
    expect(snapshot.solutionSteps[0]).toEqual({
      body: "Count all tickets: 4 + 3 + 5 = 12.",
      order: 1,
    });
  });

  it("preserves and backfills legacy content and activity rows", async () => {
    const database = await databaseThrough("006_syllabus_topic_order.sql");

    await database.exec(`
      insert into topics (
        id,
        title,
        description,
        sort_order,
        week_number,
        module_ref,
        is_active
      )
      values ('probability', 'Probability', 'Legacy topic', 1, 1, 'M1', true);

      insert into questions (
        id,
        topic_id,
        pattern_id,
        title,
        prompt,
        difficulty,
        accepted_answers_json,
        answer_explanation,
        source_type,
        trust_level,
        review_status,
        visibility,
        reviewed_by
      )
      values (
        'legacy-question',
        'probability',
        'legacy-untracked-pattern',
        'Legacy question',
        'What is one half?',
        'foundational',
        '["0.5"]'::jsonb,
        'One divided by two is 0.5.',
        'original_demo',
        'public_original',
        'approved',
        'public',
        'professor'
      );

      insert into hints (question_id, hint_order, body)
      values ('legacy-question', 1, 'Divide one by two.');

      insert into solution_steps (question_id, step_order, body)
      values ('legacy-question', 1, 'Compute 1 / 2.');

      insert into misconceptions (
        id,
        question_id,
        feedback,
        match_terms_json
      )
      values (
        'whole-number',
        'legacy-question',
        'Keep the fractional part.',
        '["1"]'::jsonb
      );

      insert into tutor_sessions (
        id,
        anonymous_user_id,
        question_id
      )
      values ('legacy-session', 'anonymous-legacy', 'legacy-question');

      insert into attempts (
        session_id,
        question_id,
        mode,
        answer_preview,
        source,
        verdict
      )
      values (
        'legacy-session',
        'legacy-question',
        'check',
        '0.5',
        'rule',
        'correct'
      );

      insert into ai_usage (scope, scope_key, date_key, interactions)
      values ('session', 'legacy-session', current_date, 1);

      insert into ai_llm_reservations (
        id,
        session_id,
        student_key_hash,
        question_key_hash,
        reserved_total_tokens,
        status,
        expires_at
      )
      values (
        'legacy-reservation',
        'legacy-session',
        'student-hash',
        'question-hash',
        100,
        'pending',
        now() + interval '1 hour'
      );
    `);

    await applyMigration(database, "007_production_schema_hardening.sql");
    await applyMigration(database, "008_approved_content_import.sql");
    await applyMigration(database, "009_authentication_authorization.sql");

    const preserved = await database.query<{
      attempts: number;
      hints: number;
      misconceptions: number;
      questions: number;
      reservations: number;
      sessions: number;
      steps: number;
      topics: number;
      usage_rows: number;
    }>(`
      select
        (select count(*)::int from topics) as topics,
        (select count(*)::int from questions) as questions,
        (select count(*)::int from hints) as hints,
        (select count(*)::int from solution_steps) as steps,
        (select count(*)::int from misconceptions) as misconceptions,
        (select count(*)::int from tutor_sessions) as sessions,
        (select count(*)::int from attempts) as attempts,
        (select count(*)::int from ai_usage) as usage_rows,
        (select count(*)::int from ai_llm_reservations) as reservations
    `);

    expect(preserved.rows[0]).toEqual({
      attempts: 1,
      hints: 1,
      misconceptions: 1,
      questions: 1,
      reservations: 1,
      sessions: 1,
      steps: 1,
      topics: 1,
      usage_rows: 1,
    });

    const question = await database.query<{
      pattern_id: string;
      reviewed_by: string;
      reviewed_by_user_id: string;
    }>(`
      select pattern_id, reviewed_by, reviewed_by_user_id
      from questions
      where id = 'legacy-question'
    `);
    expect(question.rows[0]).toEqual({
      pattern_id: "legacy-untracked-pattern",
      reviewed_by: "professor",
      reviewed_by_user_id: "system:schema-migration",
    });

    const history = await database.query<{
      decisions: number;
      versions: number;
    }>(`
      select
        (select count(*)::int from question_versions) as versions,
        (select count(*)::int from question_approval_history) as decisions
    `);
    expect(history.rows[0]).toEqual({ decisions: 1, versions: 1 });

    const attempt = await database.query<{
      question_version_id: number;
      topic_id: string;
    }>(`
      select question_version_id, topic_id
      from attempts
      where session_id = 'legacy-session'
    `);
    expect(attempt.rows[0]?.question_version_id).toBeTypeOf("number");
    expect(attempt.rows[0]?.topic_id).toBe("probability");
  });

  it("enforces publication, ordering, role, history, and deletion invariants", async () => {
    const database = await migratedDatabase();

    await database.exec(`
      insert into users (
        id,
        identity_provider,
        external_subject,
        email,
        display_name
      )
      values
        ('professor-1', 'university-sso', 'professor-subject', 'professor@example.edu', 'Professor One'),
        ('student-1', 'university-sso', 'student-subject', 'student@example.edu', 'Student One');

      insert into user_roles (user_id, role_id, granted_by_user_id)
      values
        ('professor-1', 'professor', 'system:schema-migration'),
        ('student-1', 'student', 'system:schema-migration');

      insert into topics (id, title, description, sort_order)
      values ('probability', 'Probability', 'Production topic', 1);

      set app.current_user_id = 'professor-1';

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
        review_status,
        visibility,
        reviewed_by,
        reviewed_by_user_id,
        reviewed_at
      )
      values (
        'approved-question',
        'probability',
        'Approved question',
        'What is one half?',
        'foundational',
        '["0.5"]'::jsonb,
        'One divided by two is 0.5.',
        'professor_provided',
        'professor_approved',
        'approved',
        'public',
        'Professor One',
        'professor-1',
        now()
      );
    `);

    await expect(
      database.exec(`
        insert into topics (id, title, description, sort_order)
        values ('duplicate-order', 'Duplicate order', '', 1)
      `),
    ).rejects.toThrow();

    await database.exec(`
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
        review_status,
        visibility
      )
      values (
        'draft-question',
        'probability',
        'Draft question',
        'Draft?',
        'foundational',
        '[]'::jsonb,
        'Draft.',
        'generated_original',
        'generated_unverified',
        'needs_review',
        'public'
      )
    `);

    await expect(
      database.exec(`
        update questions
        set review_status = 'approved',
            trust_level = 'professor_approved',
            reviewed_by_user_id = 'student-1',
            reviewed_at = now()
        where id = 'draft-question'
      `),
    ).rejects.toThrow(/active professor or admin identity/);

    await expect(
      database.exec(`
        insert into hints (question_id, hint_order, body)
        values ('approved-question', 0, 'Invalid order')
      `),
    ).rejects.toThrow();

    await expect(
      database.exec(`
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
          review_status,
          visibility
        )
        values (
          'unattributed-approval',
          'probability',
          'Unsafe approval',
          'Unsafe?',
          'foundational',
          '[]'::jsonb,
          'Unsafe.',
          'generated_original',
          'generated_unverified',
          'approved',
          'public'
        )
      `),
    ).rejects.toThrow();

    const initialHistory = await database.query<{ count: number }>(`
      select count(*)::int as count
      from question_approval_history
      where question_id = 'approved-question'
    `);
    expect(initialHistory.rows[0]?.count).toBe(1);

    await expect(
      database.exec(`
        update question_approval_history
        set notes = 'rewrite history'
        where question_id = 'approved-question'
      `),
    ).rejects.toThrow(/append-only/);

    await database.exec(`
      insert into audit_events (
        actor_user_id,
        actor_subject,
        action,
        entity_type,
        entity_id
      )
      values (
        'professor-1',
        'professor-subject',
        'question.approved',
        'question',
        'approved-question'
      );
    `);

    await expect(database.exec("delete from audit_events")).rejects.toThrow(
      /append-only/,
    );

    await database.exec(`
      insert into tutor_sessions (id, user_id, question_id)
      values ('student-session', 'student-1', 'approved-question');

      insert into attempts (
        session_id,
        question_id,
        mode,
        answer_preview,
        source,
        verdict
      )
      values (
        'student-session',
        'approved-question',
        'check',
        '0.5',
        'rule',
        'correct'
      );

      insert into student_progress (
        user_id,
        topic_id,
        question_id,
        question_version_id,
        status,
        attempts_count,
        best_verdict,
        first_started_at,
        completed_at
      )
      select
        'student-1',
        'probability',
        'approved-question',
        qv.id,
        'completed',
        1,
        'correct',
        now(),
        now()
      from question_versions qv
      where qv.question_id = 'approved-question'
      order by qv.version_number desc
      limit 1;

      insert into feedback_reports (
        reporter_user_id,
        reporter_subject_hash,
        tutor_session_id,
        question_id,
        question_version_id,
        category,
        message
      )
      select
        'student-1',
        'student-subject-hash',
        'student-session',
        'approved-question',
        qv.id,
        'content_error',
        'Please verify this explanation.'
      from question_versions qv
      where qv.question_id = 'approved-question'
      order by qv.version_number desc
      limit 1;

      delete from users where id = 'student-1';
    `);

    const studentRows = await database.query<{
      attempts: number;
      feedback: number;
      progress: number;
      sessions: number;
    }>(`
      select
        (select count(*)::int from tutor_sessions where user_id = 'student-1') as sessions,
        (select count(*)::int from attempts where session_id = 'student-session') as attempts,
        (select count(*)::int from student_progress where user_id = 'student-1') as progress,
        (
          select count(*)::int
          from feedback_reports
          where reporter_user_id is null
            and reporter_subject_hash = 'student-subject-hash'
        ) as feedback
    `);
    expect(studentRows.rows[0]).toEqual({
      attempts: 0,
      feedback: 1,
      progress: 0,
      sessions: 0,
    });

    await expect(
      database.exec("delete from questions where id = 'approved-question'"),
    ).rejects.toThrow();
  });
});

async function migratedDatabase() {
  return databaseThrough(migrationFiles.at(-1));
}

async function databaseThrough(lastMigration: string | undefined) {
  if (!lastMigration) {
    throw new Error("No database migration was found.");
  }

  const database = new PGlite();
  openDatabases.push(database);

  for (const file of migrationFiles) {
    await applyMigration(database, file);
    if (file === lastMigration) {
      break;
    }
  }

  return database;
}

async function applyMigration(database: PGlite, file: string) {
  const sql = readFileSync(path.join(migrationDirectory, file), "utf8");
  await database.exec(sql);
}

async function columnValues(database: PGlite, sql: string, column: string) {
  const result = await database.query<Record<string, unknown>>(sql);
  return result.rows.map((row) => String(row[column]));
}
