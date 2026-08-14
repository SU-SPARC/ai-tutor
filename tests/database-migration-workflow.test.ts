import { readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import {
  SUPPORTED_MIGRATION_COMMANDS,
  MigrationApplicationError,
  deploymentCheckExitCode,
  getMigrationStatus,
  loadMigrations,
  migrationFromSql,
  runPendingMigrations,
  validateMigrationHistory,
  type MigrationClient,
} from "../scripts/lib/database-migrations.mjs";

const migrationsDirectory = path.join(process.cwd(), "db/migrations");
const openDatabases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(
    openDatabases.splice(0).map((database) => database.close()),
  );
});

describe("safe database migration workflow", () => {
  it("loads one contiguous, checksummed, version-controlled history", async () => {
    const migrations = await loadMigrations(migrationsDirectory);

    expect(migrations.map((migration) => migration.version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
    expect(
      migrations.every((migration) =>
        /^[0-9a-f]{64}$/.test(migration.checksum),
      ),
    ).toBe(true);
    expect(
      migrations.slice(0, 9).every((migration) => !migration.destructive),
    ).toBe(true);
    expect(migrations[9]).toMatchObject({
      destructive: true,
      destructiveDirective: true,
    });
    expect(migrations[10].destructive).toBe(false);
    expect(migrations[13].destructive).toBe(false);
    expect(SUPPORTED_MIGRATION_COMMANDS).toEqual(["status", "check", "up"]);

    expect(() =>
      validateMigrationHistory([
        migrationFromSql(
          "002_gap.sql",
          "create table gap (id integer primary key);",
        ),
      ]),
    ).toThrow(/contiguous from 001/);

    expect(
      migrationFromSql(
        "001_comment_only.sql",
        "-- drop table example\ncreate table example (id integer primary key);",
      ).destructive,
    ).toBe(false);
  });

  it("reports every migration pending without mutating a fresh database", async () => {
    const database = createDatabase();
    const migrations = await loadMigrations(migrationsDirectory);

    const status = await getMigrationStatus(database, migrations);

    expect(status).toMatchObject({
      applied: [],
      issues: [],
      ledgerExists: false,
      state: "pending",
      total: 15,
    });
    expect(status.pending.map((migration) => migration.filename)).toEqual(
      migrations.map((migration) => migration.filename),
    );
    expect(deploymentCheckExitCode(status)).toBe(2);

    const ledger = await database.query<{ ledger: string | null }>(`
      select to_regclass('public.schema_migrations')::text as ledger
    `);
    expect(ledger.rows[0]?.ledger).toBeNull();
  });

  it("applies the full history transactionally and records immutable evidence", async () => {
    const database = createDatabase();
    const statements: string[] = [];
    const client = trackingClient(database, statements);
    const migrations = await loadMigrations(migrationsDirectory);

    const firstRun = await runPendingMigrations({
      actor: "ci:migration-test",
      allowDestructive: true,
      changeTicket: "TEST-ROLE-SIMPLIFICATION",
      client,
      deploymentSha: "0123456789abcdef",
      destructiveApprovedBy: "ci:independent-approver",
      migrations,
      target: "test",
    });

    expect(firstRun.applied).toHaveLength(15);
    expect(firstRun.status.state).toBe("current");
    expect(deploymentCheckExitCode(firstRun.status)).toBe(0);
    expect(statements[0]).toContain("pg_advisory_lock");
    expect(
      statements.filter((statement) => statement === "begin"),
    ).toHaveLength(15);
    expect(
      statements.filter((statement) => statement === "commit"),
    ).toHaveLength(15);
    expect(statements.at(-1)).toContain("pg_advisory_unlock");

    const ledger = await database.query<{
      actor: string;
      change_ticket: string | null;
      checksum: string;
      deployment_sha: string;
      filename: string;
      target: string;
      version: number;
    }>(`
      select
        version,
        filename,
        checksum,
        actor,
        deployment_sha,
        target,
        change_ticket
      from schema_migrations
      order by version
    `);
    expect(ledger.rows).toHaveLength(15);
    expect(ledger.rows[0]).toMatchObject({
      actor: "ci:migration-test",
      deployment_sha: "0123456789abcdef",
      filename: "001_initial_schema.sql",
      target: "test",
      version: 1,
    });
    expect(ledger.rows.map((row) => row.checksum)).toEqual(
      migrations.map((migration) => migration.checksum),
    );

    await expect(
      database.exec(`
        update schema_migrations
        set actor = 'rewritten'
        where version = 1
      `),
    ).rejects.toThrow(/append-only/);

    const secondRun = await runPendingMigrations({
      actor: "ci:migration-test",
      allowDestructive: true,
      changeTicket: "TEST-ROLE-SIMPLIFICATION",
      client,
      deploymentSha: "0123456789abcdef",
      destructiveApprovedBy: "ci:independent-approver",
      migrations,
      target: "test",
    });
    expect(secondRun.applied).toEqual([]);
    expect(secondRun.status.state).toBe("current");
  });

  it("detects changed and unknown applied migrations before deployment", async () => {
    const database = createDatabase();
    const migrations = await loadMigrations(migrationsDirectory);
    await runPendingMigrations({
      actor: "ci:migration-test",
      allowDestructive: true,
      changeTicket: "TEST-ROLE-SIMPLIFICATION",
      client: database,
      deploymentSha: "0123456789abcdef",
      destructiveApprovedBy: "ci:independent-approver",
      migrations,
      target: "test",
    });

    const changedHistory = migrations.map((migration) =>
      migration.version === 3
        ? { ...migration, checksum: "0".repeat(64) }
        : migration,
    );
    const changedStatus = await getMigrationStatus(database, changedHistory);
    expect(changedStatus.state).toBe("drift");
    expect(changedStatus.issues).toContainEqual(
      expect.objectContaining({
        code: "checksum_mismatch",
        version: 3,
      }),
    );
    expect(deploymentCheckExitCode(changedStatus)).toBe(1);

    await database.exec(`
      insert into schema_migrations (
        version,
        filename,
        checksum,
        actor,
        deployment_sha,
        target,
        execution_ms
      )
      values (
        999,
        '999_unknown.sql',
        '${"f".repeat(64)}',
        'external',
        'external',
        'test',
        0
      )
    `);
    const unknownStatus = await getMigrationStatus(database, migrations);
    expect(unknownStatus.issues).toContainEqual(
      expect.objectContaining({
        code: "unknown_applied_migration",
        version: 999,
      }),
    );
  });

  it("commits completed migrations and rolls back an interrupted migration", async () => {
    const database = createDatabase();
    const migrations = [
      migrationFromSql(
        "001_create_stable_table.sql",
        "create table stable_table (id integer primary key);",
      ),
      migrationFromSql(
        "002_fail_after_write.sql",
        `
          create table rolled_back_table (id integer primary key);
          insert into missing_table (id) values (1);
        `,
      ),
    ];

    await expect(
      runPendingMigrations({
        actor: "ci:migration-test",
        client: database,
        deploymentSha: "interrupted-sha",
        migrations,
        target: "test",
      }),
    ).rejects.toBeInstanceOf(MigrationApplicationError);

    const relations = await database.query<{
      rolled_back: string | null;
      stable: string | null;
    }>(`
      select
        to_regclass('public.stable_table')::text as stable,
        to_regclass('public.rolled_back_table')::text as rolled_back
    `);
    expect(relations.rows[0]).toEqual({
      rolled_back: null,
      stable: "stable_table",
    });

    const ledger = await database.query<{ version: number }>(`
      select version from schema_migrations order by version
    `);
    expect(ledger.rows).toEqual([{ version: 1 }]);
  });

  it("requires declaration, approval, and a change ticket for destructive SQL", async () => {
    const undeclared = migrationFromSql(
      "001_drop_legacy_table.sql",
      "drop table legacy_table;",
    );
    expect(() => validateMigrationHistory([undeclared])).toThrow(
      /migration-safety: destructive/,
    );

    const database = createDatabase();
    await database.exec("create table legacy_table (id integer primary key)");
    const declared = migrationFromSql(
      "001_drop_legacy_table.sql",
      `
        -- migration-safety: destructive
        drop table legacy_table;
      `,
    );

    await expect(
      runPendingMigrations({
        actor: "ci:migration-test",
        client: database,
        deploymentSha: "destructive-sha",
        migrations: [declared],
        target: "staging",
      }),
    ).rejects.toThrow(/--allow-destructive/);

    await expect(
      runPendingMigrations({
        actor: "same-person@example.edu",
        allowDestructive: true,
        changeTicket: "CHANGE-1234",
        client: database,
        deploymentSha: "destructive-sha",
        destructiveApprovedBy: "same-person@example.edu",
        migrations: [declared],
        target: "staging",
      }),
    ).rejects.toThrow(/approver must differ/);

    const stillPresent = await database.query<{ table_name: string | null }>(`
      select to_regclass('public.legacy_table')::text as table_name
    `);
    expect(stillPresent.rows[0]?.table_name).toBe("legacy_table");

    const result = await runPendingMigrations({
      actor: "ci:migration-test",
      allowDestructive: true,
      changeTicket: "CHANGE-1234",
      client: database,
      deploymentSha: "destructive-sha",
      destructiveApprovedBy: "university-it@example.edu",
      migrations: [declared],
      target: "staging",
    });
    expect(result.status.state).toBe("current");

    const destructiveEvidence = await database.query<{
      change_ticket: string;
      destructive_approved_by: string;
      target: string;
    }>(`
      select change_ticket, destructive_approved_by, target
      from schema_migrations
      where version = 1
    `);
    expect(destructiveEvidence.rows[0]).toEqual({
      change_ticket: "CHANGE-1234",
      destructive_approved_by: "university-it@example.edu",
      target: "staging",
    });

    const removed = await database.query<{ table_name: string | null }>(`
      select to_regclass('public.legacy_table')::text as table_name
    `);
    expect(removed.rows[0]?.table_name).toBeNull();
  });

  it("requires a change ticket and explicit confirmation for Production", async () => {
    const database = createDatabase();
    const migrations = [
      migrationFromSql(
        "001_create_safe_table.sql",
        "create table safe_table (id integer primary key);",
      ),
    ];

    await expect(
      runPendingMigrations({
        actor: "release-job",
        changeTicket: "CHANGE-1234",
        client: database,
        deploymentSha: "production-sha",
        migrations,
        target: "production",
      }),
    ).rejects.toThrow(/--confirm-production/);

    await expect(
      runPendingMigrations({
        actor: "release-job",
        client: database,
        confirmProduction: true,
        deploymentSha: "production-sha",
        migrations,
        target: "production",
      }),
    ).rejects.toThrow(/MIGRATION_CHANGE_TICKET/);

    const approved = await runPendingMigrations({
      actor: "release-job",
      changeTicket: "CHANGE-1234",
      client: database,
      confirmProduction: true,
      deploymentSha: "production-sha",
      migrations,
      target: "production",
    });
    expect(approved.applied).toHaveLength(1);
    expect(approved.status.state).toBe("current");
  });

  it("documents only repository-authored commands and an empty-database CI job", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    );
    expect(packageJson.scripts).toMatchObject({
      "db:migrate": "node scripts/database-migrate.mjs up",
      "db:migrate:check": "node scripts/database-migrate.mjs check",
      "db:migrate:status": "node scripts/database-migrate.mjs status",
    });
    expect(Object.keys(packageJson.scripts)).not.toContain(
      "db:migrate:generate",
    );

    const cli = readFileSync(
      path.join(process.cwd(), "scripts/database-migrate.mjs"),
      "utf8",
    );
    expect(cli).toContain('path.resolve(repositoryRoot, "db/migrations")');
    expect(cli).not.toMatch(/generate|introspect|migrations-dir/i);

    const workflow = readFileSync(
      path.join(process.cwd(), ".github/workflows/database-migrations.yml"),
      "utf8",
    );
    expect(workflow).toContain("npm run test:migrations");
    expect(workflow).not.toMatch(/DATABASE_URL|MIGRATION_DATABASE_URL/);

    const operations = readFileSync(
      path.join(process.cwd(), "docs/database-operations.md"),
      "utf8",
    );
    expect(operations).toContain("npm run db:migrate:status");
    expect(operations).toContain("npm run db:migrate:check");
    expect(operations).toContain("--confirm-production");
    expect(operations).toContain("-- migration-safety: destructive");
    expect(operations).toMatch(/forward-fix/i);
    expect(operations).toMatch(/no destructive down-migrations/i);
  });
});

function createDatabase() {
  const database = new PGlite();
  openDatabases.push(database);
  return database;
}

function trackingClient(
  database: PGlite,
  statements: string[],
): MigrationClient {
  return {
    async exec(sql: string) {
      statements.push(normalizeSql(sql));
      return database.exec(sql);
    },
    async query(sql: string, params?: unknown[]) {
      statements.push(normalizeSql(sql));
      return database.query<Record<string, unknown>>(sql, params);
    },
  };
}

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}
