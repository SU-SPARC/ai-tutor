import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { MigrationStatus } from "../scripts/lib/database-migrations.mjs";
import type { RecoveryValidationReport } from "../scripts/lib/database-recovery.mjs";
import {
  DEFAULT_RECOVERY_POINT_OBJECTIVE_HOURS,
  DEFAULT_RECOVERY_TIME_OBJECTIVE_HOURS,
  RecoveryEvidenceError,
  assertSafeRecoveryLabel,
  createRecoveryEvidence,
  parseRecoveryPoint,
  recoveryObjectives,
  writeRecoveryEvidence,
} from "../scripts/lib/database-recovery-evidence.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

const migrationStatus = {
  applied: [
    {
      actor: "ops",
      appliedAt: "2026-09-01T00:00:00.000Z",
      checksum: "c".repeat(64),
      filename: "001_initial_schema.sql",
      target: "production",
      version: 1,
    },
    {
      actor: "ops",
      appliedAt: "2026-09-02T00:00:00.000Z",
      checksum: "d".repeat(64),
      filename: "002_tutor_session_progress.sql",
      target: "production",
      version: 2,
    },
  ],
  issues: [],
  ledgerExists: true,
  pending: [],
  state: "current",
  total: 2,
} as unknown as MigrationStatus;

const validation: RecoveryValidationReport = {
  criticalRowCounts: { questions: 9, schema_migrations: 2 },
  deferredConstraints: ["questions_pattern_id_fkey"],
  issues: [],
  latestCommittedRecordAt: "2026-09-03T09:30:00.000Z",
  migrationState: "current",
  migrationStatus,
  schemaMigrationCount: 2,
  status: "valid",
  validations: {
    criticalTables: 21,
    integrityChecks: 8,
    rebuildableTables: 1,
    requiredViews: 4,
    sequenceChecks: 11,
  },
};

describe("database recovery evidence", () => {
  it("uses documented objectives unless the operator overrides them", () => {
    expect(recoveryObjectives({})).toEqual({
      recoveryPointObjectiveHours: DEFAULT_RECOVERY_POINT_OBJECTIVE_HOURS,
      recoveryTimeObjectiveHours: DEFAULT_RECOVERY_TIME_OBJECTIVE_HOURS,
    });
    expect(
      recoveryObjectives({
        RECOVERY_TEST_RPO_HOURS: "4",
        RECOVERY_TEST_RTO_HOURS: "8",
      }),
    ).toEqual({
      recoveryPointObjectiveHours: 4,
      recoveryTimeObjectiveHours: 8,
    });
    expect(() => recoveryObjectives({ RECOVERY_TEST_RPO_HOURS: "-1" })).toThrow(
      RecoveryEvidenceError,
    );
    expect(parseRecoveryPoint(" 2026-09-03T10:00:00Z ")).toBe(
      "2026-09-03T10:00:00.000Z",
    );
    expect(parseRecoveryPoint("")).toBeUndefined();
    expect(() => parseRecoveryPoint("yesterday")).toThrow(/ISO-8601/);
    expect(() =>
      assertSafeRecoveryLabel("postgres://a:b@c/d", "--source-label"),
    ).toThrow(/without URLs/);
  });

  it("records durations, recovery point, objectives, and ledger target without secrets", async () => {
    const evidence = createRecoveryEvidence({
      actor: "it.operator",
      changeTicket: "RECOVERY-91",
      exerciseCompletedAt: "2026-09-03T12:10:00.000Z",
      exerciseStartedAt: "2026-09-03T12:00:00.000Z",
      integrityAudit: {
        checks: [],
        generatedAt: "2026-09-03T12:09:00.000Z",
        status: "clean",
        summary: {
          failedChecks: 0,
          findings: 0,
          passedChecks: 18,
          totalChecks: 18,
        },
        target: "production",
      },
      migrationStatus,
      mode: "restore",
      objectives: recoveryObjectives({}),
      recoveryPointAt: "2026-09-03T10:00:00.000Z",
      restore: {
        archiveEntries: 366,
        archiveSha256: "a".repeat(64),
        archiveSizeBytes: 2048,
        completedAt: "2026-09-03T12:05:00.000Z",
        durationMs: 300_000,
        restoreTool: "pg_restore",
        restoreToolVersion: "18.6",
        restoredEntries: 364,
        skippedEntries: 2,
        startedAt: "2026-09-03T12:00:00.000Z",
      },
      sourceLabel: "provider daily backup",
      status: "passed",
      targetFingerprint: "f".repeat(64),
      validation,
      validationDurationMs: 1500,
    });

    expect(evidence).toMatchObject({
      archive: { sha256: "a".repeat(64), sizeBytes: 2048 },
      credential: "RECOVERY_TEST_DATABASE_URL",
      exercise: "disposable_database_restore",
      generatedAt: "2026-09-03T12:10:00.000Z",
      integrityAudit: { status: "clean", target: "production" },
      productionWritesAttempted: 0,
      recoveryPoint: {
        ageAtExerciseMs: 130 * 60 * 1000,
        declaredAt: "2026-09-03T10:00:00.000Z",
        latestCommittedRecordAt: "2026-09-03T09:30:00.000Z",
        ledgerLatestAppliedAt: "2026-09-02T00:00:00.000Z",
        withinObjective: true,
      },
      recoveryTime: { measuredMs: 600_000, withinObjective: true },
      restore: {
        archiveEntries: 366,
        durationMs: 300_000,
        restoredEntries: 364,
        skippedEntries: 2,
        tool: "pg_restore",
        toolVersion: "18.6",
      },
      status: "passed",
      target: "production",
      validation: {
        durationMs: 1500,
        migrationLedger: { appliedCount: 2, state: "current" },
        sequenceChecks: 11,
        status: "valid",
      },
    });

    const stale = createRecoveryEvidence({
      exerciseCompletedAt: "2026-09-05T12:00:00.000Z",
      exerciseStartedAt: "2026-09-04T00:00:00.000Z",
      mode: "validate-only",
      objectives: recoveryObjectives({ RECOVERY_TEST_RTO_HOURS: "1" }),
      recoveryPointAt: "2026-09-01T00:00:00.000Z",
      status: "failed",
      targetFingerprint: "f".repeat(64),
      validation: {
        ...validation,
        issues: [{ code: "missing_view", detail: "x" }],
        status: "invalid",
      },
    });
    expect(stale.recoveryPoint.withinObjective).toBe(false);
    expect(stale.recoveryTime.withinObjective).toBe(false);
    expect(stale.target).toBe("production");
    expect(stale.validation?.issues).toEqual([
      { code: "missing_view", detail: "x" },
    ]);
    expect(stale.archive).toBeNull();
    expect(stale.restore).toBeNull();

    const directory = await mkdtemp(
      path.join(os.tmpdir(), "recovery-evidence-test-"),
    );
    temporaryDirectories.push(directory);
    const written = await writeRecoveryEvidence(directory, evidence);
    expect(path.basename(written)).toBe(
      "2026-09-03T12-10-00-000Z-production-passed.json",
    );
    const saved = await readFile(written, "utf8");
    expect(saved).not.toMatch(/postgres(?:ql)?:\/\/|@|password/i);
    expect(JSON.parse(saved).targetFingerprint).toBe("f".repeat(64));
  });
});
