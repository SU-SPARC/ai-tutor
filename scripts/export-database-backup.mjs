#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
  BackupExportError,
  assertSafeBackupLabel,
  backupSourceFromUrl,
  createBackupManifest,
  resolveArchiveOutputPath,
  runPgDump,
  writeBackupManifest,
} from "./lib/database-backup.mjs";
import {
  SUPPORTED_INTEGRITY_TARGETS,
  assertIntegrityDatabaseTarget,
} from "./lib/database-integrity.mjs";
import {
  getMigrationStatus,
  loadMigrations,
  normalizeMigrationDatabaseUrl,
} from "./lib/database-migrations.mjs";
import { resolveRecoveryArchive } from "./lib/database-recovery.mjs";

const { Pool } = pg;
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) {
    printUsage();
    return;
  }

  const databaseUrl = process.env.BACKUP_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "BACKUP_DATABASE_URL is required; runtime, migration, import, integrity, and recovery credentials are never used.",
    );
  }
  const actor = assertSafeBackupLabel(process.env.BACKUP_ACTOR, "BACKUP_ACTOR");
  const changeTicket = assertSafeBackupLabel(
    process.env.BACKUP_CHANGE_TICKET,
    "BACKUP_CHANGE_TICKET",
  );
  if (!actor || !changeTicket) {
    throw new Error("BACKUP_ACTOR and BACKUP_CHANGE_TICKET are required.");
  }
  const sourceLabel = assertSafeBackupLabel(
    process.env.BACKUP_SOURCE_LABEL,
    "BACKUP_SOURCE_LABEL",
  );
  const pgDumpCommand =
    options.pgDump ?? process.env.PG_DUMP_COMMAND?.trim() ?? "pg_dump";

  const source = backupSourceFromUrl(databaseUrl);
  const outputPath = await resolveArchiveOutputPath(options.output, {
    repositoryRoot,
  });
  const migrations = await loadMigrations(
    path.resolve(repositoryRoot, "db/migrations"),
  );

  const { migrationStatus, server } = await withReadOnlyClient(
    databaseUrl,
    async (client) => {
      const identity = await client.query(
        "select now() as snapshot_at, current_setting('server_version') as version, current_database()::text as database_name",
      );
      const row = identity.rows[0] ?? {};
      if (String(row.database_name ?? "") !== source.databaseName) {
        throw new Error(
          "Connected database name differs from the credential safe fingerprint.",
        );
      }
      const status = await getMigrationStatus(client, migrations);
      await assertIntegrityDatabaseTarget(client, options.target);
      return {
        migrationStatus: status,
        server: {
          snapshotAt: new Date(row.snapshot_at).toISOString(),
          version: String(row.version ?? "unknown"),
        },
      };
    },
  );

  const dump = runPgDump({ databaseUrl, outputPath, pgDumpCommand });
  const archive = await resolveRecoveryArchive(outputPath);
  const manifest = createBackupManifest({
    actor,
    archive,
    changeTicket,
    dump,
    migrationStatus,
    server,
    source,
    sourceLabel,
    target: options.target,
  });

  let manifestPath;
  if (options.manifestDir) {
    manifestPath = await writeBackupManifest(options.manifestDir, manifest);
  }
  printReport(manifest, manifestPath, options.json);
}

export function parseArguments(args) {
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true };
  }

  const options = { json: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--output") {
      options.output = requiredArgumentValue(args, ++index, argument);
    } else if (argument === "--target") {
      options.target = requiredArgumentValue(args, ++index, argument);
    } else if (argument === "--manifest-dir") {
      options.manifestDir = requiredArgumentValue(args, ++index, argument);
    } else if (argument === "--pg-dump") {
      options.pgDump = requiredArgumentValue(args, ++index, argument);
    } else if (argument === "--json") {
      options.json = true;
    } else {
      throw new Error(`Unknown backup export option: ${argument}.`);
    }
  }
  if (!options.output) {
    throw new Error("--output is required.");
  }
  if (
    !options.target ||
    !SUPPORTED_INTEGRITY_TARGETS.includes(options.target)
  ) {
    throw new Error(
      `--target must be one of ${SUPPORTED_INTEGRITY_TARGETS.join(", ")}.`,
    );
  }
  return options;
}

function requiredArgumentValue(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

async function withReadOnlyClient(databaseUrl, work) {
  const pool = new Pool({
    application_name: "ai-tutor-logical-backup-export",
    connectionString: normalizeMigrationDatabaseUrl(databaseUrl),
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 5_000,
    max: 1,
    options: "-c default_transaction_read_only=on",
    query_timeout: 30_000,
    statement_timeout: 30_000,
  });
  const client = await pool.connect();
  try {
    await client.query("begin transaction read only");
    try {
      return await work(client);
    } finally {
      await client.query("rollback").catch(() => undefined);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

function printReport(manifest, manifestPath, json) {
  if (json) {
    console.log(JSON.stringify({ ...manifest, manifestPath }, null, 2));
    return;
  }
  console.log("Logical backup export: exported");
  console.log(`Target: ${manifest.target}`);
  console.log(`Recovery point: ${manifest.recoveryPoint.at}`);
  console.log(`Migration state: ${manifest.migrationLedger.state}`);
  console.log(`Archive SHA-256: ${manifest.archive.sha256}`);
  console.log(`Archive bytes: ${manifest.archive.sizeBytes}`);
  console.log(`Export duration ms: ${manifest.export.durationMs}`);
  if (manifestPath) {
    console.log(`Manifest: ${manifestPath}`);
  }
}

function printUsage() {
  console.log(`Usage:
  npm run db:backup:export -- --output <outside-repo>/backup.dump --target <production|staging|test> [--manifest-dir <dir>] [--json] [--pg-dump <command>]

Environment (backup credential only):
  BACKUP_DATABASE_URL   Read-only backup credential for the source database
  BACKUP_ACTOR          Named operator or institutional job
  BACKUP_CHANGE_TICKET  Approved backup/recovery ticket ID
  BACKUP_SOURCE_LABEL   Optional short non-secret label for the archive
  PG_DUMP_COMMAND       Optional pg_dump path when a newer client is required

The command records the server snapshot time as the recovery point, runs pg_dump
in custom format for the public schema only, and writes a sanitized manifest.
It never reads DATABASE_URL, MIGRATION_DATABASE_URL, CONTENT_IMPORT_DATABASE_URL,
INTEGRITY_DATABASE_URL, or RECOVERY_TEST_DATABASE_URL.`);
}

function redactError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(
    /postgres(?:ql)?:\/\/[^\s]+/gi,
    "[REDACTED_DATABASE_URL]",
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const label =
      error instanceof BackupExportError
        ? `Logical backup export refused (${error.code})`
        : "Logical backup export failed";
    console.error(`${label}: ${redactError(error)}`);
    process.exitCode = 1;
  });
}
