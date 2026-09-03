import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BackupExportError,
  PG_DUMP_ARGUMENTS,
  assertSafeBackupLabel,
  createBackupManifest,
  resolveArchiveOutputPath,
  runPgDump,
  sanitizeToolOutput,
} from "../scripts/lib/database-backup.mjs";
import { fingerprintDatabaseUrl } from "../scripts/lib/database-integrity-evidence.mjs";
import type { MigrationStatus } from "../scripts/lib/database-migrations.mjs";
import { parseArguments } from "../scripts/export-database-backup.mjs";

const temporaryDirectories: string[] = [];
const sourceUrl =
  "postgresql://backup_reader:backup_secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres?sslmode=require";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("logical backup export", () => {
  it("rejects labels that could carry credentials", () => {
    expect(
      assertSafeBackupLabel("  daily export ", "BACKUP_SOURCE_LABEL"),
    ).toBe("daily export");
    expect(
      assertSafeBackupLabel(undefined, "BACKUP_SOURCE_LABEL"),
    ).toBeUndefined();
    expect(() =>
      assertSafeBackupLabel("postgres://a:b@host/db", "BACKUP_SOURCE_LABEL"),
    ).toThrow(BackupExportError);
    expect(() => assertSafeBackupLabel("user@host", "BACKUP_ACTOR")).toThrow(
      /without URLs/,
    );
  });

  it("keeps archives outside the repository and never overwrites one", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "backup-export-test-"),
    );
    temporaryDirectories.push(directory);
    const repositoryRoot = process.cwd();

    await expect(
      resolveArchiveOutputPath("docs/evidence/backup.dump", { repositoryRoot }),
    ).rejects.toMatchObject({ code: "output_inside_repository" });
    await expect(
      resolveArchiveOutputPath(path.join(directory, "backup.sql"), {
        repositoryRoot,
      }),
    ).rejects.toMatchObject({ code: "output_extension" });
    await expect(
      resolveArchiveOutputPath(path.join(directory, "missing", "backup.dump"), {
        repositoryRoot,
      }),
    ).rejects.toMatchObject({ code: "output_directory_missing" });
    await expect(
      resolveArchiveOutputPath(undefined, { repositoryRoot }),
    ).rejects.toMatchObject({ code: "output_required" });

    const existing = path.join(directory, "existing.dump");
    await writeFile(existing, "retained");
    await expect(
      resolveArchiveOutputPath(existing, { repositoryRoot }),
    ).rejects.toMatchObject({ code: "output_exists" });

    await expect(
      resolveArchiveOutputPath(path.join(directory, "fresh.dump"), {
        repositoryRoot,
      }),
    ).resolves.toBe(path.join(directory, "fresh.dump"));
  });

  it("runs pg_dump read-only with the credential in the environment only", () => {
    const calls: Array<{
      args: string[];
      command: string;
      options: { env: NodeJS.ProcessEnv };
    }> = [];
    const spawnSyncImpl = vi.fn((command, args, options) => {
      calls.push({ args, command, options });
      return {
        status: 0,
        stderr: "",
        stdout: args.includes("--version") ? "pg_dump (PostgreSQL) 18.6" : "",
      };
    });

    const result = runPgDump({
      databaseUrl: sourceUrl,
      inheritedEnvironment: {
        DATABASE_URL: "postgres://production-runtime-secret",
        MIGRATION_DATABASE_URL: "postgres://production-migration-secret",
        PATH: "/usr/bin",
        RECOVERY_TEST_DATABASE_URL: "postgres://restore-secret",
      },
      outputPath: "/secure/backup.dump",
      pgDumpCommand: "/opt/pg18/bin/pg_dump",
      spawnSyncImpl,
    });

    expect(result).toMatchObject({ tool: "pg_dump", toolVersion: "18.6" });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(result.completedAt)).toBeGreaterThanOrEqual(
      Date.parse(result.startedAt),
    );
    expect(calls[0].command).toBe("/opt/pg18/bin/pg_dump");
    expect(calls[0].args).toEqual([
      ...PG_DUMP_ARGUMENTS,
      "--file",
      "/secure/backup.dump",
    ]);
    expect(PG_DUMP_ARGUMENTS).toContain("--schema=public");
    expect(PG_DUMP_ARGUMENTS).not.toContain("--data-only");
    expect(calls[0].options.env).toMatchObject({
      PGDATABASE: "postgres",
      PGHOST: "db.abcdefghijklmnopqrst.supabase.co",
      PGOPTIONS: "-c default_transaction_read_only=on",
      PGPASSWORD: "backup_secret",
      PGSSLMODE: "require",
      PGUSER: "backup_reader",
    });
    for (const name of [
      "DATABASE_URL",
      "MIGRATION_DATABASE_URL",
      "RECOVERY_TEST_DATABASE_URL",
    ]) {
      expect(calls[0].options.env).not.toHaveProperty(name);
    }
    expect(JSON.stringify(calls.map((call) => call.args))).not.toMatch(
      /backup_secret|postgres:\/\//,
    );
  });

  it("fails closed with sanitized tool output", () => {
    const failing = vi.fn(() => ({
      status: 1,
      stderr:
        'pg_dump: error: connection to server at "db.abcdefghijklmnopqrst.supabase.co" failed for user backup_reader password backup_secret',
      stdout: "",
    }));
    let failure: unknown;
    try {
      runPgDump({
        databaseUrl: sourceUrl,
        inheritedEnvironment: {},
        outputPath: "/secure/backup.dump",
        spawnSyncImpl: failing,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(BackupExportError);
    const message = String((failure as Error).message);
    expect(message).toContain("[REDACTED]");
    expect(message).not.toContain("backup_secret");
    expect(message).not.toContain("backup_reader");
    expect(message).not.toContain("supabase.co");

    expect(
      sanitizeToolOutput("see postgresql://x:y@host/db now", sourceUrl),
    ).toBe("see [REDACTED_DATABASE_URL] now");
  });

  it("builds a manifest with the recovery point and only safe identity", () => {
    const migrationStatus = {
      applied: [
        {
          actor: "ops",
          checksum: "c".repeat(64),
          filename: "001_initial_schema.sql",
          target: "production",
          version: 1,
        },
      ],
      issues: [],
      ledgerExists: true,
      pending: [],
      state: "current",
      total: 1,
    } as unknown as MigrationStatus;

    const manifest = createBackupManifest({
      actor: "it.operator",
      archive: { sha256: "a".repeat(64), sizeBytes: 4096 },
      changeTicket: "BACKUP-7",
      dump: {
        completedAt: "2026-09-03T12:00:05.000Z",
        durationMs: 5000,
        startedAt: "2026-09-03T12:00:00.000Z",
        tool: "pg_dump",
        toolVersion: "18.6",
      },
      migrationStatus,
      server: { snapshotAt: "2026-09-03T11:59:59.000Z", version: "17.4" },
      source: fingerprintDatabaseUrl(sourceUrl),
      sourceLabel: "weekly logical copy",
      target: "production",
    });

    expect(manifest).toMatchObject({
      archive: { format: "custom", schema: "public", sizeBytes: 4096 },
      artifact: "logical_database_backup",
      credential: "BACKUP_DATABASE_URL",
      generatedAt: "2026-09-03T12:00:05.000Z",
      migrationLedger: { appliedCount: 1, state: "current" },
      recoveryPoint: { at: "2026-09-03T11:59:59.000Z" },
      source: {
        databaseName: "postgres",
        endpointKind: "direct",
        provider: "supabase",
      },
      status: "exported",
      writesAttempted: 0,
    });
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toMatch(
      /backup_secret|backup_reader|supabase\.co|abcdefghijklmnopqrst|postgres:\/\//,
    );
  });

  it("requires an output path and a supported ledger target", () => {
    expect(
      parseArguments([
        "--output",
        "/x/y.dump",
        "--target",
        "production",
        "--json",
      ]),
    ).toEqual({ json: true, output: "/x/y.dump", target: "production" });
    expect(() => parseArguments(["--target", "production"])).toThrow(
      /--output/,
    );
    expect(() =>
      parseArguments(["--output", "/x/y.dump", "--target", "development"]),
    ).toThrow(/--target must be one of/);
    expect(() => parseArguments(["--output", "/x/y.dump", "--drop"])).toThrow(
      /Unknown/,
    );
  });
});
