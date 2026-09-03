import {
  summarizeMigrationStatus,
  writeIntegrityEvidence,
} from "./database-integrity-evidence.mjs";

export const DEFAULT_RECOVERY_POINT_OBJECTIVE_HOURS = 24;
export const DEFAULT_RECOVERY_TIME_OBJECTIVE_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;
const UNSAFE_LABEL_PATTERN = /:\/\/|@|[\r\n]/;

export class RecoveryEvidenceError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = "RecoveryEvidenceError";
  }
}

export function recoveryObjectives(environment = {}) {
  return {
    recoveryPointObjectiveHours: positiveHours(
      environment.RECOVERY_TEST_RPO_HOURS,
      DEFAULT_RECOVERY_POINT_OBJECTIVE_HOURS,
      "RECOVERY_TEST_RPO_HOURS",
    ),
    recoveryTimeObjectiveHours: positiveHours(
      environment.RECOVERY_TEST_RTO_HOURS,
      DEFAULT_RECOVERY_TIME_OBJECTIVE_HOURS,
      "RECOVERY_TEST_RTO_HOURS",
    ),
  };
}

export function assertSafeRecoveryLabel(value, name) {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length > 200 || UNSAFE_LABEL_PATTERN.test(trimmed)) {
    throw new RecoveryEvidenceError(
      `${name} must be a short label without URLs, credentials, or line breaks.`,
      "unsafe_label",
    );
  }
  return trimmed;
}

export function parseRecoveryPoint(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return undefined;
  }
  const timestamp = Date.parse(String(value).trim());
  if (Number.isNaN(timestamp)) {
    throw new RecoveryEvidenceError(
      "--recovery-point must be an ISO-8601 timestamp such as 2026-09-03T12:00:00Z.",
      "invalid_recovery_point",
    );
  }
  return new Date(timestamp).toISOString();
}

export function createRecoveryEvidence({
  actor,
  changeTicket,
  exerciseCompletedAt,
  exerciseStartedAt,
  integrityAudit,
  migrationStatus,
  mode,
  objectives,
  recoveryPointAt,
  restore,
  sourceLabel,
  status,
  targetFingerprint,
  validation,
  validationDurationMs,
}) {
  const completedMs = Date.parse(exerciseCompletedAt);
  const totalDurationMs = Math.max(
    0,
    completedMs - Date.parse(exerciseStartedAt),
  );
  const recoveryPointAgeMs = recoveryPointAt
    ? Math.max(0, completedMs - Date.parse(recoveryPointAt))
    : null;
  const ledger = migrationStatus ?? validation?.migrationStatus;
  const applied = ledger?.applied ?? [];
  const ledgerTargets = [
    ...new Set(applied.map((entry) => String(entry.target ?? ""))),
  ].filter(Boolean);

  return {
    actor: actor ?? null,
    archive: restore
      ? { sha256: restore.archiveSha256, sizeBytes: restore.archiveSizeBytes }
      : null,
    artifactVersion: 1,
    changeTicket: changeTicket ?? null,
    credential: "RECOVERY_TEST_DATABASE_URL",
    exercise: "disposable_database_restore",
    generatedAt: exerciseCompletedAt,
    integrityAudit: integrityAudit ?? null,
    mode,
    objectives,
    productionWritesAttempted: 0,
    recoveryPoint: {
      ageAtExerciseMs: recoveryPointAgeMs,
      declaredAt: recoveryPointAt ?? null,
      latestCommittedRecordAt: validation?.latestCommittedRecordAt ?? null,
      ledgerLatestAppliedAt: latestIso(
        applied.map((entry) => entry.appliedAt ?? entry.applied_at),
      ),
      withinObjective:
        recoveryPointAgeMs === null
          ? null
          : recoveryPointAgeMs <=
            objectives.recoveryPointObjectiveHours * HOUR_MS,
    },
    recoveryTime: {
      exerciseCompletedAt,
      exerciseStartedAt,
      measuredMs: totalDurationMs,
      withinObjective:
        totalDurationMs <= objectives.recoveryTimeObjectiveHours * HOUR_MS,
    },
    restore: restore
      ? {
          archiveEntries: restore.archiveEntries ?? null,
          completedAt: restore.completedAt,
          durationMs: restore.durationMs,
          restoredEntries: restore.restoredEntries ?? null,
          skippedEntries: restore.skippedEntries ?? null,
          startedAt: restore.startedAt,
          tool: restore.restoreTool,
          toolVersion: restore.restoreToolVersion,
        }
      : null,
    sourceLabel: sourceLabel ?? null,
    status,
    target:
      ledgerTargets.length === 1
        ? ledgerTargets[0]
        : ledgerTargets.length === 0
          ? "unknown"
          : "mixed",
    targetFingerprint,
    validation: validation
      ? {
          criticalRowCounts: validation.criticalRowCounts,
          deferredConstraints: validation.deferredConstraints,
          durationMs: validationDurationMs ?? null,
          integrityChecks: validation.validations.integrityChecks,
          issues: validation.issues,
          migrationLedger: ledger ? summarizeMigrationStatus(ledger) : null,
          migrationState: validation.migrationState,
          schemaMigrationCount: validation.schemaMigrationCount,
          sequenceChecks: validation.validations.sequenceChecks,
          status: validation.status,
        }
      : null,
  };
}

export async function writeRecoveryEvidence(evidenceDirectory, evidence) {
  return writeIntegrityEvidence(evidenceDirectory, evidence);
}

function positiveHours(value, fallback, name) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new RecoveryEvidenceError(
      `${name} must be a positive number of hours.`,
      "invalid_objective",
    );
  }
  return hours;
}

function latestIso(values) {
  let latest = null;
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }
    const timestamp =
      value instanceof Date ? value.getTime() : Date.parse(String(value));
    if (Number.isNaN(timestamp)) {
      continue;
    }
    if (latest === null || timestamp > latest) {
      latest = timestamp;
    }
  }
  return latest === null ? null : new Date(latest).toISOString();
}
