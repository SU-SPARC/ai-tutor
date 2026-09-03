import type { summarizeMigrationStatus } from "./database-integrity-evidence.mjs";
import type { MigrationStatus } from "./database-migrations.mjs";
import type {
  PgRestoreResult,
  RecoveryValidationIssue,
  RecoveryValidationReport,
  RestoredIntegrityAudit,
} from "./database-recovery.mjs";

export const DEFAULT_RECOVERY_POINT_OBJECTIVE_HOURS: number;
export const DEFAULT_RECOVERY_TIME_OBJECTIVE_HOURS: number;

export class RecoveryEvidenceError extends Error {
  code: string;
}

export type RecoveryObjectives = {
  recoveryPointObjectiveHours: number;
  recoveryTimeObjectiveHours: number;
};

export type RecoveryEvidence = {
  actor: string | null;
  archive: { sha256: string; sizeBytes: number } | null;
  artifactVersion: 1;
  changeTicket: string | null;
  credential: "RECOVERY_TEST_DATABASE_URL";
  exercise: "disposable_database_restore";
  generatedAt: string;
  integrityAudit: RestoredIntegrityAudit | null;
  mode: string;
  objectives: RecoveryObjectives;
  productionWritesAttempted: 0;
  recoveryPoint: {
    ageAtExerciseMs: number | null;
    declaredAt: string | null;
    latestCommittedRecordAt: string | null;
    ledgerLatestAppliedAt: string | null;
    withinObjective: boolean | null;
  };
  recoveryTime: {
    exerciseCompletedAt: string;
    exerciseStartedAt: string;
    measuredMs: number;
    withinObjective: boolean;
  };
  restore: {
    archiveEntries: number | null;
    completedAt: string;
    durationMs: number;
    restoredEntries: number | null;
    skippedEntries: number | null;
    startedAt: string;
    tool: string;
    toolVersion: string;
  } | null;
  sourceLabel: string | null;
  status: "failed" | "passed";
  target: string;
  targetFingerprint: string;
  validation: {
    criticalRowCounts: Record<string, number>;
    deferredConstraints: string[];
    durationMs: number | null;
    integrityChecks: number;
    issues: RecoveryValidationIssue[];
    migrationLedger: ReturnType<typeof summarizeMigrationStatus> | null;
    migrationState: string;
    schemaMigrationCount: number;
    sequenceChecks: number;
    status: "invalid" | "valid";
  } | null;
};

export function recoveryObjectives(
  environment?: Record<string, string | undefined>,
): RecoveryObjectives;
export function assertSafeRecoveryLabel(
  value: unknown,
  name: string,
): string | undefined;
export function parseRecoveryPoint(value: unknown): string | undefined;
export function createRecoveryEvidence(options: {
  actor?: string;
  changeTicket?: string;
  exerciseCompletedAt: string;
  exerciseStartedAt: string;
  integrityAudit?: RestoredIntegrityAudit;
  migrationStatus?: MigrationStatus;
  mode: string;
  objectives: RecoveryObjectives;
  recoveryPointAt?: string;
  restore?: PgRestoreResult;
  sourceLabel?: string;
  status: "failed" | "passed";
  targetFingerprint: string;
  validation?: RecoveryValidationReport;
  validationDurationMs?: number;
}): RecoveryEvidence;
export function writeRecoveryEvidence(
  evidenceDirectory: string,
  evidence: RecoveryEvidence,
): Promise<string>;
