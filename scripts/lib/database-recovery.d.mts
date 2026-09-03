import type {
  IntegrityAuditReport,
  IntegrityTarget,
} from "./database-integrity.mjs";
import type { Migration, MigrationStatus } from "./database-migrations.mjs";

export const CRITICAL_RECOVERY_TABLES: readonly string[];
export const REBUILDABLE_RECOVERY_TABLES: readonly string[];
export const REQUIRED_RECOVERY_VIEWS: readonly string[];

export class RecoverySafetyError extends Error {}
export class RecoveryValidationError extends Error {
  issues: RecoveryValidationIssue[];
  report: RecoveryValidationReport;
  evidencePath?: string;
}

export type RecoveryTarget = {
  database: string;
  disposableMarker: string;
  fingerprint: string;
  host: string;
  port: string;
};

export type QueryClient = {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type RecoveryValidationIssue = {
  code: string;
  detail: string;
  violations?: number;
};

export type RecoveryValidationReport = {
  criticalRowCounts: Record<string, number>;
  deferredConstraints: string[];
  issues: RecoveryValidationIssue[];
  latestCommittedRecordAt: string | null;
  migrationState: string;
  migrationStatus: MigrationStatus;
  schemaMigrationCount: number;
  status: "invalid" | "valid";
  validations: {
    criticalTables: number;
    integrityChecks: number;
    rebuildableTables: number;
    requiredViews: number;
    sequenceChecks: number;
  };
};

export type RecoveryArchive = {
  path: string;
  sha256: string;
  sizeBytes: number;
};

export type PgRestoreResult = {
  archiveEntries: number;
  archiveSha256: string;
  archiveSizeBytes: number;
  completedAt: string;
  durationMs: number;
  restoreTool: "pg_restore";
  restoreToolVersion: string;
  restoredEntries: number;
  skippedEntries: number;
  startedAt: string;
};

export type RestoredIntegrityAudit =
  | {
      checks: IntegrityAuditReport["checks"];
      generatedAt: string;
      status: "clean" | "findings";
      summary: IntegrityAuditReport["summary"];
      target: IntegrityTarget;
    }
  | { reason: string; status: "skipped"; target: string | null };

export type SpawnSyncLike = (...args: unknown[]) => {
  error?: Error;
  status: number | null;
  stderr?: string;
  stdout?: string;
};

export function recoveryTargetFromUrl(databaseUrl: string): RecoveryTarget;
export function assertRecoveryExecutionAuthorization(options: {
  actor?: string;
  changeTicket?: string;
  confirmation?: string;
  target: RecoveryTarget;
}): void;
export function resolveRecoveryArchive(
  archivePath: string,
): Promise<RecoveryArchive>;
export function assertEmptyDisposableDatabase(
  client: QueryClient,
): Promise<void>;
export function assertConnectedRecoveryTarget(
  client: QueryClient,
  target: RecoveryTarget,
): Promise<void>;
export function runPgRestore(options: {
  archive: RecoveryArchive;
  databaseUrl: string;
  inheritedEnvironment?: Record<string, string | undefined>;
  pgRestoreCommand?: string;
  spawnSyncImpl?: SpawnSyncLike;
}): PgRestoreResult;
export function validateRestoredDatabase(options: {
  client: QueryClient;
  migrations: Migration[];
}): Promise<RecoveryValidationReport>;
export function detectLedgerTarget(
  client: QueryClient,
): Promise<string | undefined>;
export function auditRestoredDatabaseIntegrity(
  client: QueryClient,
): Promise<RestoredIntegrityAudit>;
export function selectRestorableEntries(listing: string): {
  list: string;
  restored: number;
  skipped: number;
  total: number;
};
export function sanitizeToolOutput(
  output: unknown,
  databaseUrl: string,
): string;
export function minimalPostgresEnvironment(
  environment: Record<string, string | undefined>,
): NodeJS.ProcessEnv;
export function postgresEnvironmentFromUrl(
  databaseUrl: string,
): NodeJS.ProcessEnv;
