import type {
  SafeDatabaseFingerprint,
  summarizeMigrationStatus,
} from "./database-integrity-evidence.mjs";
import type { MigrationStatus } from "./database-migrations.mjs";
import type { RecoveryArchive, SpawnSyncLike } from "./database-recovery.mjs";

export const LOGICAL_BACKUP_SCHEMA: "public";
export const PG_DUMP_ARGUMENTS: readonly string[];

export class BackupExportError extends Error {
  code: string;
}

export type PgDumpResult = {
  completedAt: string;
  durationMs: number;
  startedAt: string;
  tool: "pg_dump";
  toolVersion: string;
};

export type BackupManifest = {
  actor: string;
  archive: {
    format: "custom";
    schema: "public";
    sha256: string;
    sizeBytes: number;
  };
  artifact: "logical_database_backup";
  artifactVersion: 1;
  changeTicket: string;
  credential: "BACKUP_DATABASE_URL";
  export: PgDumpResult;
  generatedAt: string;
  migrationLedger: ReturnType<typeof summarizeMigrationStatus>;
  readOnly: true;
  recoveryPoint: { at: string };
  server: { snapshotAt: string; version: string };
  source: {
    databaseName: string;
    endpointKind: string;
    hostHash: string;
    projectIdentityHash: string | null;
    provider: string;
    roleHash: string;
  };
  sourceLabel: string | null;
  status: "exported";
  target: string;
  writesAttempted: 0;
};

export function backupSourceFromUrl(
  databaseUrl: string,
): SafeDatabaseFingerprint;
export function assertSafeBackupLabel(
  value: unknown,
  name: string,
): string | undefined;
export function resolveArchiveOutputPath(
  outputPath: string | undefined,
  options: { repositoryRoot: string },
): Promise<string>;
export function postgresClientVersion(
  command: string,
  spawnSyncImpl?: SpawnSyncLike,
  inheritedEnvironment?: Record<string, string | undefined>,
): string;
export function runPgDump(options: {
  databaseUrl: string;
  inheritedEnvironment?: Record<string, string | undefined>;
  outputPath: string;
  pgDumpCommand?: string;
  spawnSyncImpl?: SpawnSyncLike;
}): PgDumpResult;
export function createBackupManifest(options: {
  actor: string;
  archive: Pick<RecoveryArchive, "sha256" | "sizeBytes">;
  changeTicket: string;
  dump: PgDumpResult;
  migrationStatus: MigrationStatus;
  server: { snapshotAt: string; version: string };
  source: SafeDatabaseFingerprint;
  sourceLabel?: string;
  target: string;
}): BackupManifest;
export function writeBackupManifest(
  manifestDirectory: string,
  manifest: BackupManifest,
): Promise<string>;
export function sanitizeToolOutput(
  output: unknown,
  databaseUrl: string,
): string;
