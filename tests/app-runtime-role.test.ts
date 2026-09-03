import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import {
  loadMigrations,
  runPendingMigrations,
} from "../scripts/lib/database-migrations.mjs";

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
        has_sequence_privilege('app_runtime', 'attempts_id_seq', 'USAGE') as sequence_usage,
        has_function_privilege('app_runtime', 'app_set_updated_at()', 'EXECUTE') as trigger_execute,
        (select count(*)::int from pg_policies where policyname = 'app_runtime_full_access') as availability_policies
      from pg_roles
      where rolname = 'app_runtime'
    `);
    expect(verification.rows[0]).toEqual({
      availability_policies: 3,
      rolbypassrls: false,
      rolcanlogin: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolsuper: false,
      schema_create: false,
      sequence_usage: true,
      session_insert: true,
      trigger_execute: true,
      version_select: true,
    });
  });
});
