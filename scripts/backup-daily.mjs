#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
  BACKUP_CUSTODY_POLICY,
  BackupCustodyError,
  appendLedgerEntry,
  backupArchiveName,
  backupCustodyOwnership,
  encryptBackupArchive,
  ensureCustodyStore,
  importBackupPublicKey,
  newBackupRunId,
  optionalSafeLabel,
  readLedger,
  requiredSafeLabel,
  resolveCustodyStore,
  sanitizeErrorCode,
  selectArchivesToPrune,
} from "./lib/backup-custody.mjs";
import { expectedBackupTarget } from "./lib/database-backup-evidence.mjs";
import {
  BackupExportError,
  backupSourceFromUrl,
  createBackupManifest,
  runPgDump,
} from "./lib/database-backup.mjs";
import { writeIntegrityEvidence } from "./lib/database-integrity-evidence.mjs";
import {
  SUPPORTED_INTEGRITY_TARGETS,
  assertIntegrityDatabaseTarget,
} from "./lib/database-integrity.mjs";
import {
  getMigrationStatus,
  loadMigrations,
  normalizeMigrationDatabaseUrl,
} from "./lib/database-migrations.mjs";
import {
  minimalPostgresEnvironment,
  resolveRecoveryArchive,
  selectRestorableEntries,
} from "./lib/database-recovery.mjs";

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
  const environment = process.env;
  const databaseUrl = environment.BACKUP_DATABASE_URL;
  if (!databaseUrl) {
    throw new BackupCustodyError(
      "BACKUP_DATABASE_URL is required; runtime, migration, import, integrity, and recovery credentials are never used.",
      "credential_unavailable",
    );
  }
  const actor = requiredSafeLabel(environment.BACKUP_ACTOR, "BACKUP_ACTOR");
  const changeTicket = requiredSafeLabel(
    environment.BACKUP_CHANGE_TICKET,
    "BACKUP_CHANGE_TICKET",
  );
  const sourceLabel =
    optionalSafeLabel(environment.BACKUP_SOURCE_LABEL, "BACKUP_SOURCE_LABEL") ??
    "daily encrypted logical export";
  const custodyRegion = optionalSafeLabel(
    environment.BACKUP_CUSTODY_REGION,
    "BACKUP_CUSTODY_REGION",
  );
  // Fail before any database work if the approved recovery key is invalid.
  importBackupPublicKey(environment.BACKUP_ENCRYPTION_PUBLIC_KEY);
  const ownership = backupCustodyOwnership(environment);
  const store = await ensureCustodyStore(
    resolveCustodyStore({ environment, repositoryRoot }),
  );
  const source = backupSourceFromUrl(databaseUrl);
  if (options.target === "production") {
    const expected = expectedBackupTarget(environment);
    if (
      source.provider !== expected.provider ||
      source.projectIdentityHash !== expected.projectIdentityHash ||
      source.databaseName !== expected.databaseName
    ) {
      throw new BackupCustodyError(
        "The backup credential does not point at the expected Production project and database.",
        "database_target_mismatch",
      );
    }
  }

  const runId = newBackupRunId();
  const archiveName = backupArchiveName(runId, options.target);
  const stagingPath = path.join(
    store.stagingDir,
    `${runId}-${options.target}.dump`,
  );
  const archivePath = path.join(store.archivesDir, archiveName);
  await appendLedgerEntry(store, {
    actor,
    changeTicket,
    custodyRegion: custodyRegion ?? null,
    runId,
    status: "started",
    target: options.target,
  });

  let manifest;
  try {
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
          throw new BackupCustodyError(
            "Connected database name differs from the credential safe fingerprint.",
            "database_target_mismatch",
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
    const dump = runPgDump({
      databaseUrl,
      outputPath: stagingPath,
      pgDumpCommand:
        options.pgDump ?? environment.PG_DUMP_COMMAND?.trim() ?? "pg_dump",
    });
    const archive = await resolveRecoveryArchive(stagingPath);
    const readability = inspectArchive({
      archivePath: stagingPath,
      environment,
      pgRestoreCommand:
        options.pgRestore ??
        environment.PG_RESTORE_COMMAND?.trim() ??
        "pg_restore",
    });
    const encryptedStartedMs = Date.now();
    const envelope = await encryptBackupArchive({
      inputPath: stagingPath,
      outputPath: archivePath,
      publicKey: environment.BACKUP_ENCRYPTION_PUBLIC_KEY,
    });
    const encryptionDurationMs = Date.now() - encryptedStartedMs;
    await unlink(stagingPath);

    const base = createBackupManifest({
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
    manifest = {
      ...base,
      artifact: "encrypted_logical_database_backup",
      custody: {
        archiveEntries: readability.total,
        archiveName,
        ciphertextSha256: envelope.ciphertextSha256,
        encryptedBytes: envelope.encryptedBytes,
        encryption: BACKUP_CUSTODY_POLICY.encryption,
        encryptionDurationMs,
        plaintextRemovedFromStaging: true,
        recipientKeyFingerprint: envelope.recipientKeyFingerprint,
        region: custodyRegion ?? null,
        retentionDays: BACKUP_CUSTODY_POLICY.retentionDays,
        runId,
        store: "institutional_custody_directory",
      },
      ownership,
      status: "encrypted",
    };
    await appendLedgerEntry(store, {
      actor,
      archive: {
        ciphertextSha256: envelope.ciphertextSha256,
        encryptedBytes: envelope.encryptedBytes,
        name: archiveName,
        plaintextBytes: envelope.plaintextBytes,
        plaintextSha256: envelope.plaintextSha256,
        recipientKeyFingerprint: envelope.recipientKeyFingerprint,
      },
      changeTicket,
      custodyRegion: custodyRegion ?? null,
      ledgerFingerprint: manifest.migrationLedger.ledgerFingerprint,
      ownership,
      recoveryPointAt: manifest.recoveryPoint.at,
      runId,
      status: "completed",
      target: options.target,
    });
  } catch (error) {
    await unlink(stagingPath).catch(() => undefined);
    await appendLedgerEntry(store, {
      error: { code: sanitizeErrorCode(error) },
      runId,
      status: "failed",
      target: options.target,
    });
    throw error;
  }

  const storeManifestPath = path.join(
    store.manifestsDir,
    `${runId}-${options.target}.json`,
  );
  await writeFile(storeManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  let manifestPath;
  if (options.manifestDir) {
    manifestPath = await writeIntegrityEvidence(options.manifestDir, manifest);
  }

  let pruned = [];
  if (options.prune) {
    const { entries } = await readLedger(store);
    const overdue = selectArchivesToPrune({ entries });
    for (const entry of overdue) {
      await unlink(path.join(store.archivesDir, entry.archive.name)).catch(
        (error) => {
          if (error?.code !== "ENOENT") throw error;
        },
      );
      pruned.push(entry.archive.name);
    }
    if (pruned.length > 0) {
      await appendLedgerEntry(store, {
        actor,
        changeTicket,
        prunedArchives: pruned,
        retentionDays: BACKUP_CUSTODY_POLICY.retentionDays,
        runId,
        status: "pruned",
        target: options.target,
      });
    }
  }

  printReport({ manifest, manifestPath, pruned }, options.json);
}

export function parseArguments(args) {
  if (args.includes("--help") || args.includes("-h")) return { help: true };
  const options = { json: false, prune: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--target") {
      options.target = requiredArgumentValue(args, ++index, argument);
    } else if (argument === "--manifest-dir") {
      options.manifestDir = requiredArgumentValue(args, ++index, argument);
    } else if (argument === "--pg-dump") {
      options.pgDump = requiredArgumentValue(args, ++index, argument);
    } else if (argument === "--pg-restore") {
      options.pgRestore = requiredArgumentValue(args, ++index, argument);
    } else if (argument === "--prune") {
      options.prune = true;
    } else if (argument === "--json") {
      options.json = true;
    } else {
      throw new BackupCustodyError(
        `Unknown daily backup option: ${argument}.`,
        "invalid_option",
      );
    }
  }
  if (
    !options.target ||
    !SUPPORTED_INTEGRITY_TARGETS.includes(options.target)
  ) {
    throw new BackupCustodyError(
      `--target must be one of ${SUPPORTED_INTEGRITY_TARGETS.join(", ")}.`,
      "invalid_option",
    );
  }
  return options;
}

function inspectArchive({ archivePath, environment, pgRestoreCommand }) {
  const result = spawnSync(pgRestoreCommand, ["--list", archivePath], {
    encoding: "utf8",
    env: minimalPostgresEnvironment(environment),
    stdio: "pipe",
  });
  if (result?.error || result?.status !== 0) {
    throw new BackupCustodyError(
      "The exported archive could not be listed by pg_restore and must not be retained.",
      "archive_unreadable",
    );
  }
  const listing = selectRestorableEntries(String(result.stdout ?? ""));
  if (listing.restored === 0) {
    throw new BackupCustodyError(
      "The exported archive lists no restorable entries.",
      "archive_empty",
    );
  }
  return listing;
}

async function withReadOnlyClient(databaseUrl, work) {
  const pool = new Pool({
    application_name: "ai-tutor-daily-encrypted-backup",
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

function requiredArgumentValue(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new BackupCustodyError(
      `${option} requires a value.`,
      "invalid_option",
    );
  }
  return value;
}

function printReport({ manifest, manifestPath, pruned }, json) {
  if (json) {
    console.log(JSON.stringify({ ...manifest, manifestPath, pruned }, null, 2));
    return;
  }
  console.log("Daily encrypted backup: completed");
  console.log(`Target: ${manifest.target}`);
  console.log(`Run: ${manifest.custody.runId}`);
  console.log(`Recovery point: ${manifest.recoveryPoint.at}`);
  console.log(`Migration state: ${manifest.migrationLedger.state}`);
  console.log(`Plaintext SHA-256: ${manifest.archive.sha256}`);
  console.log(`Encrypted SHA-256: ${manifest.custody.ciphertextSha256}`);
  console.log(`Encrypted bytes: ${manifest.custody.encryptedBytes}`);
  console.log(
    `Recovery key fingerprint: ${manifest.custody.recipientKeyFingerprint}`,
  );
  console.log(`Ownership: ${manifest.ownership.status}`);
  console.log(`Pruned archives: ${pruned.length}`);
  if (manifestPath) console.log(`Manifest: ${manifestPath}`);
}

function printUsage() {
  console.log(`Usage:
  npm run db:backup:daily -- --target production [--manifest-dir docs/evidence/database-recovery] [--prune] [--json] [--pg-dump <path>] [--pg-restore <path>]

Environment (injected from the institutional secret store):
  BACKUP_DATABASE_URL              Dedicated read-only backup credential
  BACKUP_CUSTODY_DIR               Absolute custody directory outside Git and hosting
  BACKUP_ENCRYPTION_PUBLIC_KEY     Approved X25519 recovery public key (base64 DER)
  BACKUP_ACTOR / BACKUP_CHANGE_TICKET
  BACKUP_CUSTODY_REGION            Approved custody region label
  BACKUP_EXPECTED_PROVIDER / BACKUP_EXPECTED_PROJECT_HASH / BACKUP_EXPECTED_DATABASE_NAME
  BACKUP_INSTITUTIONAL_OWNER_1 / BACKUP_INSTITUTIONAL_OWNER_2 / BACKUP_OPERATOR (fingerprinted only)

The command records a started ledger entry, exports the public schema with
pg_dump in a read-only session, proves the archive lists restorable entries,
encrypts it to the approved recovery key, deletes the plaintext, records a
completed ledger entry with digests, writes a sanitized manifest, and with
--prune removes archives past the ${BACKUP_CUSTODY_POLICY.retentionDays}-day retention (never the newest).
Any failure records a failed ledger entry and exits non-zero. The private
recovery key is never needed and never present on the backup host.`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code =
      error instanceof BackupCustodyError || error instanceof BackupExportError
        ? error.code
        : "operation_failed";
    const message = String(error?.message ?? error).replace(
      /postgres(?:ql)?:\/\/\S+/gi,
      "[REDACTED_DATABASE_URL]",
    );
    console.error(`Daily encrypted backup failed (${code}): ${message}`);
    process.exitCode = 1;
  });
}
