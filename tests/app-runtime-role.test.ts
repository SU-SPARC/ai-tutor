import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import {
  loadMigrations,
  runPendingMigrations,
} from "../scripts/lib/database-migrations.mjs";
import {
  readRlsEvidence,
  readRoleAttestation,
} from "../scripts/verify-production-database-custody.mjs";

const openDatabases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(
    openDatabases.splice(0).map((database) => database.close()),
  );
});

describe("least-privilege runtime role provisioning", () => {
  it("applies idempotently on the migrated schema and denies every administrative capability", async () => {
    const database = new PGlite();
    openDatabases.push(database);
    const client = {
      async exec(sql: string) {
        return database.exec(sql);
      },
      async query(sql: string, params?: unknown[]) {
        return database.query<Record<string, unknown>>(sql, params);
      },
    };
    const migrations = await loadMigrations(
      path.resolve(process.cwd(), "db/migrations"),
    );
    await runPendingMigrations({
      actor: "runtime-role-test",
      allowDestructive: true,
      changeTicket: "TEST-RUNTIME-ROLE",
      client,
      deploymentSha: "c".repeat(40),
      destructiveApprovedBy: "independent-runtime-role-approver",
      migrations,
      target: "test",
    });

    const script = await readFile(
      path.resolve(process.cwd(), "db/roles/app_runtime.sql"),
      "utf8",
    );
    expect(script).not.toMatch(/password\s+'/i);
    await database.exec(script);
    await database.exec(script);

    await database.exec(`
      insert into users (
        id, identity_provider, external_subject, email, display_name, status
      ) values (
        'user:runtime-role-professor', 'test', 'runtime-role-professor',
        'runtime-role-professor@example.invalid', 'Runtime Role Professor',
        'active'
      );
      insert into user_roles (user_id, role_id)
      values ('user:runtime-role-professor', 'professor');
      insert into topics (
        id, title, description, sort_order, week_number, module_ref, is_active
      ) values (
        'runtime-role-topic', 'Runtime role topic', '', 999, 1,
        'runtime-role-module', true
      );
      select set_config('app.current_user_id', 'user:runtime-role-professor', false);
      select set_config('app.current_creation_method', 'manual', false);
      select set_config('app.suppress_question_version', 'true', false);
      insert into questions (
        id, topic_id, title, prompt, difficulty, accepted_answers_json,
        answer_explanation, source_type, trust_level, review_status,
        visibility, originality_note, reviewed_by, reviewed_by_user_id
      ) values
      (
        'runtime-role-reserve-question', 'runtime-role-topic',
        'Runtime role reserve question', 'What is one half?', 'foundational',
        '["0.5"]'::jsonb, 'One divided by two.', 'professor_provided',
        'public_original', 'needs_review', 'public',
        'Original runtime-role permission fixture.', 'Runtime Role Professor',
        'user:runtime-role-professor'
      ),
      (
        'runtime-role-origin-question', 'runtime-role-topic',
        'Runtime role origin question', 'What is one third?', 'foundational',
        '["1/3"]'::jsonb, 'One divided by three.', 'professor_provided',
        'public_original', 'needs_review', 'public',
        'Original runtime-role origin fixture.', 'Runtime Role Professor',
        'user:runtime-role-professor'
      );
      insert into hints (question_id, hint_order, body)
      values
        ('runtime-role-reserve-question', 1, 'Start with the numerator and denominator.'),
        ('runtime-role-origin-question', 1, 'Start with the numerator and denominator.');
      insert into solution_steps (question_id, step_order, body)
      values
        ('runtime-role-reserve-question', 1, 'Compute 1 / 2 = 0.5.'),
        ('runtime-role-origin-question', 1, 'Compute 1 / 3.');
      select set_config('app.suppress_question_version', 'false', false);
      select app_record_question_version('runtime-role-reserve-question');
      select set_config('app.current_user_id', 'system:schema-migration', false);
      select set_config('app.current_creation_method', 'imported', false);
      select app_record_question_version('runtime-role-origin-question');
    `);
    const reserveVersion = await database.query<{ id: number }>(`
      select working_version_id as id
      from questions
      where id = 'runtime-role-reserve-question'
    `);
    await database.query(
      `select * from app_transition_question_version(
        $1, $2, 'submit', $3, $4, 'draft'
      )`,
      [
        "runtime-role-reserve-question",
        Number(reserveVersion.rows[0].id),
        "user:runtime-role-professor",
        "Runtime Role Professor",
      ],
    );
    await database.query(
      `select * from app_transition_question_version(
        $1, $2, 'approve', $3, $4, 'needs_review'
      )`,
      [
        "runtime-role-reserve-question",
        Number(reserveVersion.rows[0].id),
        "user:runtime-role-professor",
        "Runtime Role Professor",
      ],
    );
    const originVersion = await database.query<{ id: number }>(`
      select working_version_id as id
      from questions
      where id = 'runtime-role-origin-question'
    `);
    for (const [action, expectedState] of [
      ["submit", "draft"],
      ["approve", "needs_review"],
      ["publish", "approved"],
    ] as const) {
      await database.query(
        `select * from app_transition_question_version(
          $1, $2, $3, $4, $5, $6
        )`,
        [
          "runtime-role-origin-question",
          Number(originVersion.rows[0].id),
          action,
          "user:runtime-role-professor",
          "Runtime Role Professor",
          expectedState,
        ],
      );
    }

    const verification = await database.query<Record<string, unknown>>(`
      select
        rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolcanlogin,
        has_schema_privilege('app_runtime', 'public', 'CREATE') as schema_create,
        has_table_privilege('app_runtime', 'tutor_sessions', 'INSERT') as session_insert,
        has_table_privilege('app_runtime', 'question_versions', 'SELECT') as version_select,
        has_table_privilege('app_runtime', 'question_reserve_events', 'INSERT') as reserve_event_insert,
        has_table_privilege('app_runtime', 'app_reserve_practice_questions', 'SELECT') as reserve_view_select,
        has_table_privilege('app_runtime', 'schema_migrations', 'INSERT') as ledger_insert,
        has_table_privilege('app_runtime', 'roles', 'UPDATE') as role_update,
        has_sequence_privilege('app_runtime', 'attempts_id_seq', 'USAGE') as sequence_usage,
        has_function_privilege('app_runtime', 'app_set_updated_at()', 'EXECUTE') as trigger_execute,
        has_function_privilege('app_runtime', 'app_question_publication_gate_failures(text,bigint,text)', 'EXECUTE') as publication_gate_execute,
        has_function_privilege('app_runtime', 'app_question_snapshot(text)', 'EXECUTE') as snapshot_execute,
        has_function_privilege('app_runtime', 'app_record_question_version(text)', 'EXECUTE') as version_function_execute,
        has_function_privilege('app_runtime', 'app_user_can_review(text)', 'EXECUTE') as reviewer_function_execute,
        (select count(*)::int from pg_policies where policyname = 'app_runtime_full_access') as runtime_policies,
        (select count(*)::int from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity) as row_level_security_tables
      from pg_roles
      where rolname = 'app_runtime'
    `);
    expect(verification.rows[0]).toEqual({
      row_level_security_tables: 30,
      ledger_insert: false,
      publication_gate_execute: true,
      role_update: false,
      reviewer_function_execute: true,
      reserve_event_insert: true,
      reserve_view_select: true,
      runtime_policies: 30,
      rolbypassrls: false,
      rolcanlogin: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolsuper: false,
      schema_create: false,
      sequence_usage: true,
      session_insert: true,
      snapshot_execute: true,
      trigger_execute: false,
      version_select: true,
      version_function_execute: true,
    });

    await database.exec("set role app_runtime");
    await expect(
      database.query("select app_question_snapshot('missing-question')"),
    ).resolves.toBeDefined();
    await expect(
      database.query("select app_record_question_version('missing-question')"),
    ).resolves.toBeDefined();
    await expect(
      database.exec(`
        select set_config('app.reserve_write', 'allowed', true);
        update questions
        set is_reserved = true,
            reserve_practice_allowed = true,
            reserve_reason_code = 'save_for_later',
            reserved_by_user_id = 'user:runtime-role-professor',
            reserved_at = now()
        where id = 'runtime-role-reserve-question';
        insert into question_reserve_events (
          question_id, question_version_id, action, reason_code,
          actor_user_id, actor_subject, actor_display_name
        )
        select
          q.id, q.working_version_id, 'reserve', 'save_for_later',
          'user:runtime-role-professor', 'runtime-role-professor',
          'Runtime Role Professor'
        from questions q
        where q.id = 'runtime-role-reserve-question';
      `),
    ).resolves.toBeDefined();
    await expect(
      database.query(
        "select count(*)::int as count from question_reserve_events where question_id = 'runtime-role-reserve-question'",
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
    await expect(
      database.query(
        "select count(*)::int as count from app_reserve_practice_questions where id = 'runtime-role-reserve-question'",
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
    await expect(
      database.exec(`
        insert into tutor_sessions (
          id, user_id, question_id, solved, status, current_state,
          completed_at
        ) values (
          'runtime-role-origin-session', 'user:runtime-role-professor',
          'runtime-role-origin-question', true, 'completed', 'solved', now()
        );
        insert into tutor_sessions (
          id, user_id, question_id, question_version_id,
          practice_context, origin_session_id
        ) select
          'runtime-role-reserve-session', 'user:runtime-role-professor',
          q.id, q.working_version_id, 'reserve_practice',
          'runtime-role-origin-session'
        from questions q
        where q.id = 'runtime-role-reserve-question';
      `),
    ).resolves.toBeDefined();
    await expect(
      database.exec("create table runtime_must_not_create (id integer)"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      database.exec(`
        insert into schema_migrations (
          version, filename, checksum, actor, deployment_sha, target,
          execution_ms
        ) values (
          99, '099_forbidden.sql', repeat('f', 64), 'runtime', 'runtime',
          'production', 0
        )
      `),
    ).rejects.toThrow(/permission denied/);
    await expect(readRoleAttestation(client)).resolves.toMatchObject({
      bypassRls: false,
      executableRoutineCount: 8,
      missingRuntimeFunctionCount: 0,
      missingRuntimeWriteCount: 0,
      protectedWriteCount: 0,
      roleHash: expect.stringMatching(/^[0-9a-f]{16}$/),
      roleMembershipCount: 0,
      schemaCreate: false,
      unexpectedRuntimeWriteCount: 0,
    });
    await expect(readRlsEvidence(client)).resolves.toMatchObject({
      dataApiGrantCount: 0,
      status: "passed",
      tableCount: 30,
    });
    await database.exec("reset role");
  });

  it("provisions distinct operator roles without making them application logins", async () => {
    const database = new PGlite();
    openDatabases.push(database);
    const client = {
      async exec(sql: string) {
        return database.exec(sql);
      },
      async query(sql: string, params?: unknown[]) {
        return database.query<Record<string, unknown>>(sql, params);
      },
    };
    const migrations = await loadMigrations(
      path.resolve(process.cwd(), "db/migrations"),
    );
    await runPendingMigrations({
      actor: "operator-role-test",
      allowDestructive: true,
      changeTicket: "TEST-OPERATOR-ROLES",
      client,
      deploymentSha: "d".repeat(40),
      destructiveApprovedBy: "independent-operator-role-approver",
      migrations,
      target: "test",
    });

    const runtimeScript = await readFile(
      path.resolve(process.cwd(), "db/roles/app_runtime.sql"),
      "utf8",
    );
    const operatorScript = await readFile(
      path.resolve(process.cwd(), "db/roles/production_operator_roles.sql"),
      "utf8",
    );
    expect(operatorScript).not.toMatch(/password\s+'/i);
    await database.exec(runtimeScript);
    await database.exec(operatorScript);
    await database.exec(operatorScript);

    const roles = await database.query<Record<string, unknown>>(`
      select rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
             rolreplication, rolbypassrls
      from pg_roles
      where rolname in ('app_migrator', 'integrity_audit', 'backup_export')
      order by rolname
    `);
    expect(roles.rows).toEqual([
      {
        rolbypassrls: false,
        rolcanlogin: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolname: "app_migrator",
        rolreplication: false,
        rolsuper: false,
      },
      {
        rolbypassrls: true,
        rolcanlogin: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolname: "backup_export",
        rolreplication: false,
        rolsuper: false,
      },
      {
        rolbypassrls: true,
        rolcanlogin: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolname: "integrity_audit",
        rolreplication: false,
        rolsuper: false,
      },
    ]);

    const grants = await database.query<Record<string, unknown>>(`
      select
        has_table_privilege('integrity_audit', 'questions', 'SELECT') as audit_select,
        has_table_privilege('integrity_audit', 'questions', 'UPDATE') as audit_update,
        has_sequence_privilege('backup_export', 'attempts_id_seq', 'SELECT') as backup_sequence_select,
        has_sequence_privilege('backup_export', 'attempts_id_seq', 'UPDATE') as backup_sequence_update,
        pg_get_userbyid(c.relowner) as questions_owner
      from pg_class c
      where c.oid = 'questions'::regclass
    `);
    expect(grants.rows[0]).toEqual({
      audit_select: true,
      audit_update: false,
      backup_sequence_select: true,
      backup_sequence_update: false,
      questions_owner: "app_migrator",
    });

    const boundaries = await database.query<Record<string, unknown>>(`
      select
        (select count(*)::int from pg_class c join pg_namespace n
          on n.oid = c.relnamespace where n.nspname = 'public'
          and c.relkind in ('r', 'p', 'v', 'm')
          and not has_table_privilege('integrity_audit', c.oid, 'SELECT'))
          as audit_select_missing,
        (select count(*)::int from pg_class c join pg_namespace n
          on n.oid = c.relnamespace where n.nspname = 'public'
          and c.relkind in ('r', 'p', 'v', 'm')
          and not has_table_privilege('backup_export', c.oid, 'SELECT'))
          as backup_select_missing,
        (select count(*)::int from pg_class c join pg_namespace n
          on n.oid = c.relnamespace where n.nspname = 'public'
          and c.relkind in ('r', 'p') and (
            has_table_privilege('integrity_audit', c.oid, 'INSERT') or
            has_table_privilege('integrity_audit', c.oid, 'UPDATE') or
            has_table_privilege('integrity_audit', c.oid, 'DELETE') or
            has_table_privilege('backup_export', c.oid, 'INSERT') or
            has_table_privilege('backup_export', c.oid, 'UPDATE') or
            has_table_privilege('backup_export', c.oid, 'DELETE')
          )) as reader_write_count,
        (select count(*)::int from pg_class c join pg_namespace n
          on n.oid = c.relnamespace where n.nspname = 'public'
          and c.relkind in ('r', 'p', 'v', 'm')
          and c.relowner <> 'app_migrator'::regrole)
          as migrator_relation_ownership_missing,
        (select count(*)::int from pg_proc p join pg_namespace n
          on n.oid = p.pronamespace where n.nspname = 'public'
          and p.proowner <> 'app_migrator'::regrole)
          as migrator_routine_ownership_missing,
        (select count(*)::int from pg_proc p join pg_namespace n
          on n.oid = p.pronamespace where n.nspname = 'public'
          and (
            has_function_privilege('integrity_audit', p.oid, 'EXECUTE') or
            has_function_privilege('backup_export', p.oid, 'EXECUTE')
          )) as reader_routine_execute_count,
        (select count(*)::int from pg_roles r where r.rolname in
          ('integrity_audit', 'backup_export') and coalesce(
            'default_transaction_read_only=on' = any(r.rolconfig), false
          )) as read_only_role_count,
        (select count(*)::int from pg_auth_members m join pg_roles r
          on r.oid = m.member where r.rolname in
          ('app_runtime', 'app_migrator', 'integrity_audit', 'backup_export'))
          as operator_membership_count
    `);
    expect(boundaries.rows[0]).toEqual({
      audit_select_missing: 0,
      backup_select_missing: 0,
      migrator_relation_ownership_missing: 0,
      migrator_routine_ownership_missing: 0,
      operator_membership_count: 0,
      read_only_role_count: 2,
      reader_routine_execute_count: 0,
      reader_write_count: 0,
    });
  });
});
