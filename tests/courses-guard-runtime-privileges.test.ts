import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import {
  loadMigrations,
  runPendingMigrations,
} from "../scripts/lib/database-migrations.mjs";

const COURSE_TABLES = [
  "courses",
  "course_topics",
  "course_sections",
  "section_members",
  "section_topic_availability",
  "section_question_availability",
  "course_events",
];

const openDatabases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(
    openDatabases.splice(0).map((database) => database.close()),
  );
});

/**
 * The migration 029 session guard reads the course tables on every tutor
 * session insert, as the inserting runtime role. Tables the migrator creates
 * do not inherit the runtime role's default SELECT, so the migration must
 * grant it itself: otherwise every student's "start practice" fails between
 * applying 029 and re-running db/roles/app_runtime.sql.
 */
describe("migration 029 runtime privileges", () => {
  it("lets an existing app_runtime role read the course tables before the role file is re-run", async () => {
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
    // The role exists in production before 029 is applied.
    await database.exec(
      "create role app_runtime nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls",
    );
    await database.exec("grant usage on schema public to app_runtime");

    const migrations = await loadMigrations(
      path.resolve(process.cwd(), "db/migrations"),
    );
    await runPendingMigrations({
      actor: "courses-guard-test",
      allowDestructive: true,
      changeTicket: "TEST-COURSES-GUARD",
      client,
      deploymentSha: "d".repeat(40),
      destructiveApprovedBy: "independent-courses-guard-approver",
      migrations,
      target: "test",
    });

    const privileges = await database.query<{
      table_name: string;
      can_select: boolean;
    }>(
      `select t.table_name,
              has_table_privilege('app_runtime', t.table_name, 'SELECT') as can_select
       from unnest($1::text[]) as t(table_name)
       order by t.table_name`,
      [COURSE_TABLES],
    );
    expect(privileges.rows.filter((row) => !row.can_select)).toEqual([]);

    // Row level security without a policy hides every row from the role but
    // never errors, so the guard falls through to the published-version rule.
    await database.exec("set role app_runtime");
    const visible = await database.query<{ count: number }>(
      "select count(*)::int as count from section_question_availability",
    );
    expect(visible.rows[0]?.count).toBe(0);
    await database.exec("reset role");
  });
});
