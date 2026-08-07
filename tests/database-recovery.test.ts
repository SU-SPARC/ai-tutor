import { readFile, realpath, writeFile } from "node:fs/promises"
import path from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  CRITICAL_RECOVERY_TABLES,
  RecoverySafetyError,
  assertEmptyDisposableDatabase,
  assertRecoveryExecutionAuthorization,
  recoveryTargetFromUrl,
  resolveRecoveryArchive,
  runPgRestore,
  validateRestoredDatabase,
} from "../scripts/lib/database-recovery.mjs"
import {
  loadMigrations,
  runPendingMigrations,
} from "../scripts/lib/database-migrations.mjs"
import { parseArguments } from "../scripts/test-database-restore.mjs"

const openDatabases: PGlite[] = []
const temporaryFiles: string[] = []

afterEach(async () => {
  await Promise.all(openDatabases.splice(0).map((database) => database.close()))
  await Promise.all(
    temporaryFiles.splice(0).map(async (file) => {
      const temporaryRoot = path.dirname(file)
      const { rm } = await import("node:fs/promises")
      await rm(temporaryRoot, { force: true, recursive: true })
    }),
  )
})

describe("database recovery workflow", () => {
  it("requires an explicitly disposable target and exact fingerprint confirmation", () => {
    expect(() =>
      recoveryTargetFromUrl(
        "postgres://operator:secret@production.db.example.edu/ai_tutor",
      ),
    ).toThrow(RecoverySafetyError)

    const target = recoveryTargetFromUrl(
      "postgres://operator:secret@restore-db.example.edu/ai_tutor_recovery",
    )

    expect(target).toMatchObject({
      database: "ai_tutor_recovery",
      host: "restore-db.example.edu",
      port: "5432",
    })
    expect(target.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(() =>
      assertRecoveryExecutionAuthorization({
        actor: "it.operator@example.edu",
        changeTicket: "RECOVERY-91",
        confirmation: "wrong-target",
        target,
      }),
    ).toThrow(/exactly match/i)
    expect(() =>
      assertRecoveryExecutionAuthorization({
        actor: "it.operator@example.edu",
        changeTicket: "RECOVERY-91",
        confirmation: target.fingerprint,
        target,
      }),
    ).not.toThrow()
  })

  it("accepts one explicit mode and limits archives to restore mode", () => {
    expect(parseArguments(["--plan", "--json"])).toEqual({
      json: true,
      mode: "plan",
    })
    expect(
      parseArguments([
        "--restore",
        "--archive",
        "backup.dump",
        "--confirm-target",
        "abc",
      ]),
    ).toEqual({
      archive: "backup.dump",
      confirmation: "abc",
      json: false,
      mode: "restore",
    })
    expect(() => parseArguments(["--restore"])).toThrow(/archive/i)
    expect(() =>
      parseArguments(["--validate-only", "--archive", "backup.dump"]),
    ).toThrow(/only with --restore/i)
    expect(() => parseArguments(["--plan", "--restore"])).toThrow(
      /exactly one/i,
    )
  })

  it("passes only the disposable credential to pg_restore and never puts it in command arguments", () => {
    const calls: Array<{
      args: string[]
      command: string
      options: { env: NodeJS.ProcessEnv }
    }> = []
    const spawnSyncImpl = vi.fn((command, args, options) => {
      calls.push({ command, args, options })
      return { status: 0, stderr: "", stdout: "" }
    })
    const recoveryUrl =
      "postgres://restore_user:restore_secret@restore-db.example.edu:5433/ai_tutor_recovery?sslmode=require"

    const result = runPgRestore({
      archive: {
        path: "/secure/recovery.dump",
        sha256: "a".repeat(64),
        sizeBytes: 512,
      },
      databaseUrl: recoveryUrl,
      inheritedEnvironment: {
        CONTENT_IMPORT_DATABASE_URL: "postgres://production-import-secret",
        DATABASE_URL: "postgres://production-runtime-secret",
        MIGRATION_DATABASE_URL: "postgres://production-migration-secret",
        NODE_ENV: "test",
        PATH: "/usr/bin",
      },
      spawnSyncImpl,
    })

    expect(result).toEqual({
      archiveSha256: "a".repeat(64),
      archiveSizeBytes: 512,
      restoreTool: "pg_restore",
    })
    expect(calls).toHaveLength(2)
    expect(calls[0].args).toEqual(["--list", "/secure/recovery.dump"])
    expect(calls[1].args).toEqual([
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      "--no-privileges",
      "--dbname",
      "ai_tutor_recovery",
      "/secure/recovery.dump",
    ])
    expect(calls[1].options.env).toMatchObject({
      PGCONNECT_TIMEOUT: "10",
      PGDATABASE: "ai_tutor_recovery",
      PGHOST: "restore-db.example.edu",
      PGPASSWORD: "restore_secret",
      PGPORT: "5433",
      PGSSLMODE: "require",
      PGUSER: "restore_user",
    })
    expect(calls[1].options.env).not.toHaveProperty("DATABASE_URL")
    expect(calls[1].options.env).not.toHaveProperty("MIGRATION_DATABASE_URL")
    expect(calls[1].options.env).not.toHaveProperty(
      "CONTENT_IMPORT_DATABASE_URL",
    )
    expect(JSON.stringify(calls.map((call) => call.args))).not.toMatch(
      /restore_secret|postgres:\/\//,
    )
  })

  it("requires a non-empty archive and an empty restore target", async () => {
    const { mkdtemp } = await import("node:fs/promises")
    const temporaryRoot = await mkdtemp(
      path.join(process.env.TMPDIR ?? "/tmp", "database-recovery-test-"),
    )
    const archivePath = path.join(temporaryRoot, "backup.dump")
    temporaryFiles.push(archivePath)
    await writeFile(archivePath, "safe test archive")

    const archive = await resolveRecoveryArchive(archivePath)
    expect(archive).toMatchObject({
      path: await realpath(archivePath),
      sizeBytes: 17,
    })
    expect(archive.sha256).toMatch(/^[0-9a-f]{64}$/)

    await expect(
      assertEmptyDisposableDatabase({
        async query() {
          return { rows: [{ object_count: 1 }] }
        },
      }),
    ).rejects.toThrow(/newly created empty disposable/i)
  })

  it("validates the complete migrated schema and emits critical table counts", async () => {
    const database = new PGlite()
    openDatabases.push(database)
    const client = pgliteClient(database)
    const migrations = await loadMigrations(
      path.resolve(process.cwd(), "db/migrations"),
    )
    await runPendingMigrations({
      actor: "recovery-test",
      allowDestructive: true,
      changeTicket: "TEST-ROLE-SIMPLIFICATION",
      client,
      deploymentSha: "b".repeat(40),
      destructiveApprovedBy: "independent-recovery-approver",
      migrations,
      target: "test",
    })

    const report = await validateRestoredDatabase({ client, migrations })

    expect(report).toMatchObject({
      deferredConstraints: ["questions_pattern_id_fkey"],
      issues: [],
      migrationState: "current",
      schemaMigrationCount: migrations.length,
      status: "valid",
      validations: {
        criticalTables: CRITICAL_RECOVERY_TABLES.length,
        integrityChecks: 8,
        rebuildableTables: 1,
        requiredViews: 4,
      },
    })
    expect(Object.keys(report.criticalRowCounts)).toHaveLength(
      CRITICAL_RECOVERY_TABLES.length,
    )
    expect(report.criticalRowCounts.schema_migrations).toBe(migrations.length)

    await database.exec("drop view app_admin_retrieval_chunks")
    await expect(
      validateRestoredDatabase({ client, migrations }),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        { code: "missing_view", detail: "app_admin_retrieval_chunks" },
      ]),
    })
  })

  it("documents every required recovery decision and does not claim backups exist", async () => {
    const [runbook, cli, packageJson] = await Promise.all([
      readFile(
        path.resolve(process.cwd(), "docs/database-recovery.md"),
        "utf8",
      ),
      readFile(
        path.resolve(process.cwd(), "scripts/test-database-restore.mjs"),
        "utf8",
      ),
      readFile(path.resolve(process.cwd(), "package.json"), "utf8"),
    ])

    expect(runbook).toMatch(/proposed and testable, not provider-verified/i)
    expect(runbook).toMatch(/recovery point objective/i)
    expect(runbook).toMatch(/recovery time objective/i)
    expect(runbook).toMatch(/Restore Authorization And Preparation Checklist/i)
    expect(runbook).toMatch(/Data Validation Checklist/i)
    expect(runbook).toMatch(/Schema Migrations Must Be Retained Separately/i)
    expect(runbook).toMatch(/Disposable Restore-Test Procedure/i)
    expect(runbook).toMatch(/Recoverable Data Inventory/i)
    expect(runbook).toMatch(/Provider Verification Record/i)
    expect(runbook).toContain("npm run db:recovery:test")
    expect(runbook).not.toMatch(/Production backups (are|have been) verified/i)
    expect(cli).not.toMatch(
      /process\.env\.(DATABASE_URL|MIGRATION_DATABASE_URL|CONTENT_IMPORT_DATABASE_URL)/,
    )
    expect(JSON.parse(packageJson).scripts["db:recovery:test"]).toBe(
      "node scripts/test-database-restore.mjs",
    )
  })
})

function pgliteClient(database: PGlite) {
  return {
    async exec(sql: string) {
      return database.exec(sql)
    },
    async query(sql: string, params?: unknown[]) {
      return database.query<Record<string, unknown>>(sql, params)
    },
  }
}
