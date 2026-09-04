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

    const verification = await database.query<Record<string, unknown>>(`
      select
        rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolcanlogin,
        has_schema_privilege('app_runtime', 'public', 'CREATE') as schema_create,
        has_table_privilege('app_runtime', 'tutor_sessions', 'INSERT') as session_insert,
        has_table_privilege('app_runtime', 'question_versions', 'SELECT') as version_select,
        has_table_privilege('app_runtime', 'schema_migrations', 'INSERT') as ledger_insert,
        has_table_privilege('app_runtime', 'roles', 'UPDATE') as role_update,
        has_sequence_privilege('app_runtime', 'attempts_id_seq', 'USAGE') as sequence_usage,
        has_function_privilege('app_runtime', 'app_set_updated_at()', 'EXECUTE') as trigger_execute,
        has_function_privilege('app_runtime', 'app_question_snapshot(text)', 'EXECUTE') as snapshot_execute,
        has_function_privilege('app_runtime', 'app_record_question_version(text)', 'EXECUTE') as version_function_execute,
        has_function_privilege('app_runtime', 'app_user_can_review(text)', 'EXECUTE') as reviewer_function_execute,
        (select count(*)::int from pg_policies where policyname = 'app_runtime_full_access') as runtime_policies,
        (select count(*)::int from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity) as row_level_security_tables
      from pg_roles
      where rolname = 'app_runtime'
    `);
    expect(verification.rows[0]).toEqual({
      row_level_security_tables: 29,
      ledger_insert: false,
      role_update: false,
      reviewer_function_execute: true,
      runtime_policies: 29,
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
      executableRoutineCount: 5,
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
      tableCount: 29,
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
