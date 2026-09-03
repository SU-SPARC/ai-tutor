import { spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";

import {
  fingerprintDatabaseUrl,
  summarizeMigrationStatus,
  writeIntegrityEvidence,
} from "./database-integrity-evidence.mjs";
import {
  minimalPostgresEnvironment,
  postgresEnvironmentFromUrl,
  sanitizeToolOutput,
} from "./database-recovery.mjs";

export const LOGICAL_BACKUP_SCHEMA = "public";
export const PG_DUMP_ARGUMENTS = Object.freeze([
  "--format=custom",
  "--compress=6",
  "--no-owner",
  "--no-acl",
  `--schema=${LOGICAL_BACKUP_SCHEMA}`,
]);

const UNSAFE_LABEL_PATTERN = /:\/\/|@|[\r\n]/;

export class BackupExportError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = "BackupExportError";
  }
}

export function backupSourceFromUrl(databaseUrl) {
  try {
    return fingerprintDatabaseUrl(databaseUrl);
  } catch {
    throw new BackupExportError(
      "BACKUP_DATABASE_URL must be a valid PostgreSQL URL.",
      "invalid_database_url",
    );
  }
}

export function assertSafeBackupLabel(value, name) {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length > 200 || UNSAFE_LABEL_PATTERN.test(trimmed)) {
    throw new BackupExportError(
      `${name} must be a short label without URLs, credentials, or line breaks.`,
      "unsafe_label",
    );
  }
  return trimmed;
}

export async function resolveArchiveOutputPath(outputPath, { repositoryRoot }) {
  if (!outputPath?.trim()) {
    throw new BackupExportError("--output is required.", "output_required");
  }
  const resolved = path.resolve(outputPath);
  if (!resolved.endsWith(".dump")) {
    throw new BackupExportError(
      "The archive path must end with .dump so it is never mistaken for a plain SQL file.",
      "output_extension",
    );
  }
  const relative = path.relative(path.resolve(repositoryRoot), resolved);
  if (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    throw new BackupExportError(
      "The archive must be written outside the repository; archives never enter Git.",
      "output_inside_repository",
    );
  }
  const parent = await stat(path.dirname(resolved)).catch(() => null);
  if (!parent?.isDirectory()) {
    throw new BackupExportError(
      "The archive directory must already exist in the approved encrypted workspace.",
      "output_directory_missing",
    );
  }
  if (await stat(resolved).catch(() => null)) {
    throw new BackupExportError(
      "The archive path already exists; never overwrite a retained backup.",
      "output_exists",
    );
  }
  return resolved;
}

export function postgresClientVersion(
  command,
  spawnSyncImpl = spawnSync,
  inheritedEnvironment = process.env,
) {
  const result = spawnSyncImpl(command, ["--version"], {
    encoding: "utf8",
    env: minimalPostgresEnvironment(inheritedEnvironment),
    stdio: "pipe",
  });
  if (result?.error || result?.status !== 0) {
    return "unknown";
  }
  return String(result.stdout ?? "").match(/(\d+(?:\.\d+)*)/)?.[1] ?? "unknown";
}

export function runPgDump({
  databaseUrl,
  inheritedEnvironment = process.env,
  outputPath,
  pgDumpCommand = "pg_dump",
  spawnSyncImpl,
}) {
  const pgDump = spawnSyncImpl ?? spawnSync;
  const startedMs = Date.now();
  const result = pgDump(
    pgDumpCommand,
    [...PG_DUMP_ARGUMENTS, "--file", outputPath],
    {
      encoding: "utf8",
      env: {
        ...minimalPostgresEnvironment(inheritedEnvironment),
        ...postgresEnvironmentFromUrl(databaseUrl),
        PGCONNECT_TIMEOUT: "10",
        PGOPTIONS: "-c default_transaction_read_only=on",
      },
      stdio: "pipe",
    },
  );
  if (result?.error) {
    throw new BackupExportError(
      `Unable to run ${path.basename(pgDumpCommand)}: command unavailable.`,
      "pg_dump_unavailable",
    );
  }
  if (result?.status !== 0) {
    throw new BackupExportError(
      `pg_dump failed and the archive must not be used: ${sanitizeToolOutput(result?.stderr, databaseUrl)}`,
      "pg_dump_failed",
    );
  }
  const completedMs = Date.now();
  return {
    completedAt: new Date(completedMs).toISOString(),
    durationMs: completedMs - startedMs,
    startedAt: new Date(startedMs).toISOString(),
    tool: "pg_dump",
    toolVersion: postgresClientVersion(
      pgDumpCommand,
      pgDump,
      inheritedEnvironment,
    ),
  };
}

export function createBackupManifest({
  actor,
  archive,
  changeTicket,
  dump,
  migrationStatus,
  server,
  source,
  sourceLabel,
  target,
}) {
  return {
    actor,
    archive: {
      format: "custom",
      schema: LOGICAL_BACKUP_SCHEMA,
      sha256: archive.sha256,
      sizeBytes: archive.sizeBytes,
    },
    artifact: "logical_database_backup",
    artifactVersion: 1,
    changeTicket,
    credential: "BACKUP_DATABASE_URL",
    export: dump,
    generatedAt: dump.completedAt,
    migrationLedger: summarizeMigrationStatus(migrationStatus),
    readOnly: true,
    recoveryPoint: { at: server.snapshotAt },
    server: { snapshotAt: server.snapshotAt, version: server.version },
    source: {
      databaseName: source.databaseName,
      endpointKind: source.endpointKind,
      hostHash: source.hostHash,
      projectIdentityHash: source.projectIdentityHash ?? null,
      provider: source.provider,
      roleHash: source.roleHash,
    },
    sourceLabel: sourceLabel ?? null,
    status: "exported",
    target,
    writesAttempted: 0,
  };
}

export async function writeBackupManifest(manifestDirectory, manifest) {
  return writeIntegrityEvidence(manifestDirectory, manifest);
}

export { sanitizeToolOutput };
