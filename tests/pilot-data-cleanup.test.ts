import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertBeforeMatchesManifest,
  loadBackupEvidence,
  loadRehearsalEvidence,
  parseArguments,
  runOwnerSql,
} from "../scripts/clean-production-pilot-data.mjs";
import { safeHash } from "../scripts/lib/database-integrity-evidence.mjs";
import { runReadOnlyIntegrityAudit } from "../scripts/lib/database-integrity.mjs";
import type { MigrationClient } from "../scripts/lib/database-migrations.mjs";
import {
  loadMigrations,
  runPendingMigrations,
} from "../scripts/lib/database-migrations.mjs";
import {
  CLEANUP_TABLES,
  PilotCleanupError,
  SUSPENDED_TRIGGERS,
  buildCleanupManifest,
  buildCleanupSql,
  buildCleanupStatements,
  buildInventorySql,
  buildPlanSql,
  buildTemporaryRoleCleanupSql,
  cleanupApprovals,
  cleanupChangeContext,
  firstJsonColumn,
  sanitizeInventory,
  serializeManifest,
  summarizeManifest,
  validateCleanupManifest,
  verifyCleanupOutcome,
  type CleanupManifest,
} from "../scripts/lib/pilot-data-cleanup.mjs";

const openDatabases: PGlite[] = [];

const PROFESSOR = "user:cleanup-professor";
const STAFF = "user:cleanup-staff";
const PILOT = "user:cleanup-pilot";
const PUBLISHED = "cleanup-published-question";
const SYNTHETIC = "ai-intake-synthetic-pilot-cleanup-check";
const ROLE_NAME = `integrity_audit_${"c".repeat(16)}`;

const changeEnvironment = {
  PILOT_CLEANUP_ACTOR_USER_ID: PROFESSOR,
  PILOT_CLEANUP_CHANGE_TICKET: "PILOT-CLEANUP-2026-09-04",
  PILOT_CLEANUP_RETENTION_DECISION:
    "retain-audit-events-remove-synthetic-graph",
};

const approvalEnvironment = {
  PILOT_CLEANUP_DATA_OWNER: "Course Professor",
  PILOT_CLEANUP_DATA_OWNER_APPROVED: "true",
  PILOT_CLEANUP_IT_OPERATOR: "University IT Operator",
  PILOT_CLEANUP_IT_OPERATOR_APPROVED: "true",
  PILOT_CLEANUP_PRIVACY_REVIEWER: "Privacy Reviewer",
  PILOT_CLEANUP_PRIVACY_REVIEWER_APPROVED: "true",
  PILOT_CLEANUP_SECOND_REVIEWER: "Independent Reviewer",
  PILOT_CLEANUP_SECOND_REVIEWER_APPROVED: "true",
};

afterEach(async () => {
  await Promise.all(
    openDatabases.splice(0).map((database) => database.close()),
  );
});

describe("production pilot data cleanup", () => {
  it("plans, rehearses, and verifies an explicit-identifier cleanup that leaves the catalog and audit history intact", async () => {
    const database = await productionShapedDatabase();
    const client = clientFor(database);
    await seedPrePilotState(database);

    const plan = firstJsonColumn(
      await client.query(
        buildPlanSql({
          actorUserId: PROFESSOR,
          pilotTestUserIds: [PILOT],
          staffTrialUserIds: [STAFF],
          syntheticQuestionIds: [SYNTHETIC],
        }),
      ),
      "plan",
    );
    const manifest = buildCleanupManifest({
      changeTicket: changeEnvironment.PILOT_CLEANUP_CHANGE_TICKET,
      context: {
        actorUserId: PROFESSOR,
        pilotTestUserIds: [PILOT],
        staffTrialUserIds: [STAFF],
        syntheticQuestionIds: [SYNTHETIC],
      },
      plan,
      retentionDecision: changeEnvironment.PILOT_CLEANUP_RETENTION_DECISION,
      temporaryRoleHashes: [],
    });

    expect(manifest.identities).toMatchObject({
      pilotTestUserIds: [PILOT],
      staffTrialUserIds: [STAFF],
      syntheticQuestionIds: [SYNTHETIC],
      temporaryRoles: [],
    });
    expect(manifest.identities.retainedUserIds).toContain(PROFESSOR);
    expect(manifest.identities.retainedUserIds).toContain(STAFF);
    expect(manifest.identities.retainedUserIds).not.toContain(PILOT);
    expect(manifest.protectedCatalog.publishedQuestionIds).toEqual([PUBLISHED]);
    expect(recordCounts(manifest)).toMatchObject({
      ai_llm_reservations: 1,
      ai_response_cache: 1,
      ai_usage: 4,
      attempts: 3,
      feedback_reports: 1,
      hints: 1,
      misconceptions: 1,
      question_lifecycle_events: 6,
      question_version_inspections: 1,
      question_version_lifecycle: 1,
      question_versions: 1,
      questions: 1,
      solution_steps: 1,
      student_progress: 0,
      tutor_sessions: 3,
      user_roles: 1,
      users: 1,
    });
    expect(manifest.records.users).toEqual([{ id: PILOT }]);
    expect(manifest.records.questions).toEqual([{ id: SYNTHETIC }]);

    const sql = buildCleanupSql(manifest);
    expect(sql).not.toMatch(/\blike\b|\bilike\b|\btruncate\b/i);
    expect(sql).not.toMatch(/delete from [a-z_]+\s*;/i);
    expect(sql).not.toMatch(/delete from [a-z_]+ where [^;]*(~|similar to)/i);
    for (const spec of CLEANUP_TABLES) {
      if (manifest.records[spec.table].length > 0) {
        expect(sql).toContain(`delete from ${spec.table} where `);
      } else {
        expect(sql).not.toContain(`delete from ${spec.table} where `);
      }
    }
    expect(sql).toContain(`'${SYNTHETIC}'`);
    expect(sql).not.toContain("delete from audit_events");
    expect(sql).not.toContain("delete from schema_migrations");

    const before = sanitizeInventory(
      firstJsonColumn(await client.query(buildInventorySql()), "inventory"),
    );
    assertBeforeMatchesManifest(before, manifest);
    expect(before.markerFindings.questions).toBe(1);
    const auditBefore = await database.query<{ count: number }>(
      "select count(*)::int as count from audit_events",
    );

    await runStatements(database, buildCleanupStatements(manifest));

    const after = sanitizeInventory(
      firstJsonColumn(await client.query(buildInventorySql()), "inventory"),
    );
    const verification = verifyCleanupOutcome({ after, before, manifest });
    expect(verification).toEqual({ problems: [], status: "passed" });
    expect(after.markerFindings).toEqual({
      anonymousSessions: 0,
      auditActors: 0,
      humanUsers: 0,
      nonProductionLedgers: 0,
      questions: 0,
    });
    expect(after.publishedCatalog).toEqual(before.publishedCatalog);
    expect(after.counts.tutor_sessions).toBe(0);
    expect(after.counts.users).toBe(before.counts.users - 1);
    expect(after.counts.questions).toBe(before.counts.questions - 1);
    expect(after.auditHistory.rowCount).toBe(before.auditHistory.rowCount + 1);
    expect(after.auditHistory.contentHash).not.toBe(
      before.auditHistory.contentHash,
    );
    expect(after.disabledTriggers).toBe(0);
    expect(after.managedTriggerCount).toBe(SUSPENDED_TRIGGERS.length);

    const auditAfter = await database.query<{
      count: number;
      nulled: number;
      recorded: number;
    }>(`
      select
        count(*)::int as count,
        count(*) filter (where action = 'auth.account_created' and actor_user_id is null and actor_subject = '${PILOT}')::int as nulled,
        count(*) filter (where action = 'production_pilot_data_cleanup' and actor_user_id = '${PROFESSOR}')::int as recorded
      from audit_events
    `);
    expect(auditAfter.rows[0]).toEqual({
      count: auditBefore.rows[0].count + 1,
      nulled: 1,
      recorded: 1,
    });
    const retained = await database.query<{ id: string }>(
      "select id from users where id in ($1, $2) order by id",
      [PROFESSOR, STAFF],
    );
    expect(retained.rows.map((row) => row.id)).toEqual([PROFESSOR, STAFF]);
    const publishedStillPublished = await database.query<{ count: number }>(
      "select count(*)::int as count from app_public_questions where id = $1",
      [PUBLISHED],
    );
    expect(publishedStillPublished.rows[0].count).toBe(1);
    const guardStillActive = database.query(
      "delete from question_versions where question_id = $1",
      [PUBLISHED],
    );
    await expect(guardStillActive).rejects.toThrow(/append-only/);

    const audit = await runReadOnlyIntegrityAudit(client, {
      target: "production",
    });
    expect(audit.status).toBe("clean");
    expect(audit.summary).toEqual({
      failedChecks: 0,
      findings: 0,
      passedChecks: 20,
      totalChecks: 20,
    });

    // The same reviewed SQL cannot run twice: the snapshot preconditions fail
    // before any delete and the transaction rolls back.
    await expect(
      runStatements(database, buildCleanupStatements(manifest)),
    ).rejects.toThrow(/PILOT_CLEANUP/);
    const unchanged = sanitizeInventory(
      firstJsonColumn(await client.query(buildInventorySql()), "inventory"),
    );
    expect(unchanged.counts).toEqual(after.counts);
    expect(unchanged.disabledTriggers).toBe(0);
  });

  it("fails closed when a session belongs to an identity outside the approved pre-pilot set", async () => {
    const database = await productionShapedDatabase();
    const client = clientFor(database);
    await seedPrePilotState(database);
    await database.exec(`
      insert into users (
        id, identity_provider, external_subject, email, display_name,
        user_type, status
      ) values (
        'user:real-student', 'clerk', 'real-student-subject',
        'real.student@example.edu', 'Real Student', 'human', 'active'
      );
      insert into user_roles (user_id, role_id, granted_by_user_id)
      values ('user:real-student', 'student', 'system:schema-migration');
      insert into tutor_sessions (
        id, user_id, question_id, creation_idempotency_key
      ) values (
        'real-student-session', 'user:real-student', '${PUBLISHED}',
        'real-student-session-key'
      );
    `);
    const plan = firstJsonColumn(
      await client.query(
        buildPlanSql({
          actorUserId: PROFESSOR,
          pilotTestUserIds: [PILOT],
          staffTrialUserIds: [STAFF],
          syntheticQuestionIds: [SYNTHETIC],
        }),
      ),
      "plan",
    );
    let failure: PilotCleanupError | undefined;
    try {
      buildCleanupManifest({
        changeTicket: changeEnvironment.PILOT_CLEANUP_CHANGE_TICKET,
        context: {
          actorUserId: PROFESSOR,
          pilotTestUserIds: [PILOT],
          staffTrialUserIds: [STAFF],
          syntheticQuestionIds: [SYNTHETIC],
        },
        plan,
        retentionDecision: changeEnvironment.PILOT_CLEANUP_RETENTION_DECISION,
      });
    } catch (error) {
      failure = error as PilotCleanupError;
    }
    expect(failure).toBeInstanceOf(PilotCleanupError);
    expect(failure?.code).toBe("plan_rejected");
    expect(failure?.problems).toContain(
      `session_not_pre_pilot:${safeHash("real-student-session")}`,
    );
    expect(JSON.stringify(failure?.problems)).not.toContain("real-student");
  });

  it("refuses a synthetic question that is still student-visible and a pilot identity that owns academic history", async () => {
    const database = await productionShapedDatabase();
    const client = clientFor(database);
    await seedPrePilotState(database);
    const plan = firstJsonColumn(
      await client.query(
        buildPlanSql({
          actorUserId: PROFESSOR,
          pilotTestUserIds: [PROFESSOR],
          staffTrialUserIds: [STAFF, PILOT],
          syntheticQuestionIds: [PUBLISHED],
        }),
      ),
      "plan",
    );
    let failure: PilotCleanupError | undefined;
    try {
      buildCleanupManifest({
        changeTicket: changeEnvironment.PILOT_CLEANUP_CHANGE_TICKET,
        context: {
          actorUserId: PROFESSOR,
          pilotTestUserIds: [PROFESSOR],
          staffTrialUserIds: [STAFF, PILOT],
          syntheticQuestionIds: [PUBLISHED],
        },
        plan,
        retentionDecision: changeEnvironment.PILOT_CLEANUP_RETENTION_DECISION,
      });
    } catch (error) {
      failure = error as PilotCleanupError;
    }
    expect(failure?.problems).toEqual(
      expect.arrayContaining([
        `synthetic_question_scope:${safeHash(PUBLISHED)}`,
        `synthetic_question_unexpected_graph:${safeHash(PUBLISHED)}`,
        `pilot_user_owns_academic_history:${safeHash(PROFESSOR)}`,
        "actor_is_removed_identity",
      ]),
    );
  });

  it("rejects manifests that are not explicit primary-key lists", () => {
    const base = validManifestSkeleton();
    expect(() => validateCleanupManifest(base)).not.toThrow();
    expect(() =>
      validateCleanupManifest({
        ...base,
        records: { ...base.records, tutor_sessions: [{ id: "session-%" }] },
      }),
    ).toThrow(/explicit text record key/);
    expect(() =>
      validateCleanupManifest({
        ...base,
        records: { ...base.records, attempts: [{ id: "1 or 1=1" }] },
      }),
    ).toThrow(/explicit bigint record key/);
    expect(() =>
      validateCleanupManifest({
        ...base,
        records: { ...base.records, audit_events: [{ id: "1" }] },
      }),
    ).toThrow(/unsupported table/);
    expect(() =>
      validateCleanupManifest({
        ...base,
        records: {
          ...base.records,
          tutor_sessions: [{ id: "session-a", user_id: "x" }],
        },
      }),
    ).toThrow(/primary-key columns/);
    expect(() =>
      validateCleanupManifest({
        ...base,
        protectedCatalog: { publishedQuestionIds: [SYNTHETIC] },
      }),
    ).toThrow(/never be a cleanup target/);
    expect(() =>
      validateCleanupManifest({
        ...base,
        identities: {
          ...base.identities,
          retainedUserIds: [...base.identities.retainedUserIds, PILOT],
        },
      }),
    ).toThrow(/cannot overlap/);
    expect(() =>
      validateCleanupManifest({
        ...base,
        retentionDecision: "delete-everything",
      }),
    ).toThrow(/retention decision/);
    expect(() => buildTemporaryRoleCleanupSql({ name: "postgres" })).toThrow(
      /exact temporary/,
    );
    expect(
      buildTemporaryRoleCleanupSql({
        hash: safeHash(ROLE_NAME),
        name: ROLE_NAME,
      }),
    ).toContain(`drop role "${ROLE_NAME}"`);
  });

  it("requires four distinct named approvals, a supported retention decision, and an actor", () => {
    const approvals = cleanupApprovals(approvalEnvironment);
    expect(approvals).toEqual({
      dataOwner: {
        approved: true,
        fingerprint: safeHash("Course Professor"),
        role: "professor_data_owner",
      },
      itOperator: {
        approved: true,
        fingerprint: safeHash("University IT Operator"),
        role: "it_operator",
      },
      privacyReviewer: {
        approved: true,
        fingerprint: safeHash("Privacy Reviewer"),
        role: "privacy_retention_reviewer",
      },
      secondReviewer: {
        approved: true,
        fingerprint: safeHash("Independent Reviewer"),
        role: "independent_second_reviewer",
      },
    });
    expect(JSON.stringify(approvals)).not.toMatch(
      /Course Professor|Privacy Reviewer|University IT Operator|Independent Reviewer/,
    );
    expect(() =>
      cleanupApprovals({
        ...approvalEnvironment,
        PILOT_CLEANUP_SECOND_REVIEWER: "course professor",
      }),
    ).toThrow(/four different named people/);
    expect(() =>
      cleanupApprovals({
        ...approvalEnvironment,
        PILOT_CLEANUP_PRIVACY_REVIEWER_APPROVED: "yes",
      }),
    ).toThrow(/privacy_retention_reviewer approval/);
    expect(() => cleanupApprovals({})).toThrow(/PILOT_CLEANUP_DATA_OWNER/);
    expect(cleanupChangeContext(changeEnvironment)).toEqual({
      actorUserId: PROFESSOR,
      changeTicket: "PILOT-CLEANUP-2026-09-04",
      retentionDecision: "retain-audit-events-remove-synthetic-graph",
    });
    expect(() =>
      cleanupChangeContext({
        ...changeEnvironment,
        PILOT_CLEANUP_RETENTION_DECISION: "delete-audit-history",
      }),
    ).toThrow(/PILOT_CLEANUP_RETENTION_DECISION/);
  });

  it("parses fail-closed command options and links execution to fresh backup and rehearsal evidence", async () => {
    expect(() => parseArguments(["execute", "--target", "production"])).toThrow(
      /--evidence-dir/,
    );
    expect(() =>
      parseArguments([
        "execute",
        "--target",
        "production",
        "--evidence-dir",
        "docs/evidence/pilot-data-cleanup",
        "--manifest",
        "/tmp/manifest.json",
        "--confirm-manifest-sha256",
        "a".repeat(64),
        "--backup-evidence",
        "/tmp/backup.json",
        "--rehearsal-evidence",
        "/tmp/rehearsal.json",
        "--confirm-project-hash",
        "b".repeat(16),
        "--change-ticket",
        "PILOT-CLEANUP-2026-09-04",
      ]),
    ).toThrow(/--confirm-production/);
    expect(
      parseArguments([
        "plan",
        "--target",
        "production",
        "--manifest",
        "/tmp/manifest.json",
        "--synthetic-question-id",
        SYNTHETIC,
        "--evidence-dir",
        "docs/evidence/pilot-data-cleanup",
      ]),
    ).toMatchObject({ mode: "plan", syntheticQuestionIds: [SYNTHETIC] });
    expect(() =>
      parseArguments([
        "rehearse",
        "--manifest",
        "/tmp/manifest.json",
        "--evidence-dir",
        "docs/evidence/pilot-data-cleanup",
      ]),
    ).toThrow(/confirm-manifest-sha256/);

    const directory = await mkdtemp(path.join(tmpdir(), "pilot-cleanup-test-"));
    const backupPath = path.join(directory, "backup.json");
    const staleBackupPath = path.join(directory, "stale.json");
    const rehearsalPath = path.join(directory, "rehearsal.json");
    const archiveSha256 = "d".repeat(64);
    const backup = {
      archive: { sha256: archiveSha256 },
      exercise: "disposable_database_restore",
      generatedAt: new Date().toISOString(),
      integrityAudit: { status: "findings" },
      mode: "restore",
      recoveryPoint: { declaredAt: new Date().toISOString() },
      status: "passed",
      target: "production",
      validation: { status: "valid" },
    };
    await writeFile(backupPath, JSON.stringify(backup));
    await writeFile(
      staleBackupPath,
      JSON.stringify({
        ...backup,
        generatedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      }),
    );
    const loaded = await loadBackupEvidence(backupPath);
    expect(loaded.summary.archiveSha256).toBe(archiveSha256);
    await expect(loadBackupEvidence(staleBackupPath)).rejects.toThrow(
      /older than 24 hours/,
    );
    await writeFile(
      rehearsalPath,
      JSON.stringify({
        audit: "production_pilot_data_cleanup",
        backup: { archiveSha256 },
        cleanupSqlSha256: "e".repeat(64),
        integrityAudit: { status: "clean" },
        manifest: { sha256: "f".repeat(64) },
        phase: "rehearsed",
        status: "passed",
        target: "rehearsal",
      }),
    );
    await expect(
      loadRehearsalEvidence(rehearsalPath, {
        backup: loaded,
        manifestSha256: "f".repeat(64),
      }),
    ).resolves.toMatchObject({ cleanupSqlSha256: "e".repeat(64) });
    await expect(
      loadRehearsalEvidence(rehearsalPath, {
        backup: loaded,
        manifestSha256: "0".repeat(64),
      }),
    ).rejects.toThrow(/passed rehearsal of this exact manifest/);
  });

  it("keeps identifiers, names, and provider details out of evidence and command output", async () => {
    const database = await productionShapedDatabase();
    const client = clientFor(database);
    await seedPrePilotState(database);
    const plan = firstJsonColumn(
      await client.query(
        buildPlanSql({
          actorUserId: PROFESSOR,
          pilotTestUserIds: [PILOT],
          staffTrialUserIds: [STAFF],
          syntheticQuestionIds: [SYNTHETIC],
        }),
      ),
      "plan",
    );
    const manifest = buildCleanupManifest({
      changeTicket: changeEnvironment.PILOT_CLEANUP_CHANGE_TICKET,
      context: {
        actorUserId: PROFESSOR,
        pilotTestUserIds: [PILOT],
        staffTrialUserIds: [STAFF],
        syntheticQuestionIds: [SYNTHETIC],
      },
      plan,
      retentionDecision: changeEnvironment.PILOT_CLEANUP_RETENTION_DECISION,
    });
    const summary = summarizeManifest(manifest, serializeManifest(manifest));
    const inventory = sanitizeInventory(plan.inventory);
    const serialized = JSON.stringify({ inventory, summary });
    for (const secret of [
      PILOT,
      STAFF,
      PROFESSOR,
      SYNTHETIC,
      PUBLISHED,
      "pilot@cleanup.invalid",
      "cleanup-session",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(summary.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(summary.identities.pilotTestUserFingerprints).toEqual([
      safeHash(PILOT),
    ]);
    expect(inventory.publishedCatalog).toEqual({
      count: 1,
      fingerprint: safeHash(PUBLISHED),
    });

    const ref = "a".repeat(20);
    const spawnSyncImpl = () => ({
      status: 1,
      stderr: `permission denied for project ${ref} at postgresql://user:secret@db.example/postgres`,
      stdout: "",
    });
    let failure: PilotCleanupError | undefined;
    try {
      runOwnerSql({
        providerProjectRef: ref,
        spawnSyncImpl: spawnSyncImpl as never,
        sql: "select 1",
      });
    } catch (error) {
      failure = error as PilotCleanupError;
    }
    expect(failure?.code).toBe("provider_database_operation_failed");
    expect(failure?.message).not.toContain(ref);
    expect(failure?.message).not.toContain("secret");
    expect(failure?.message).toContain("[REF]");

    const packageJson = JSON.parse(await readFile("package.json", "utf8"));
    expect(packageJson.scripts["db:pilot-cleanup:inspect"]).toContain(
      "clean-production-pilot-data.mjs inspect --target production",
    );
    expect(packageJson.scripts["db:pilot-cleanup:execute"]).toContain(
      "--evidence-dir docs/evidence/pilot-data-cleanup",
    );
  });
});

function recordCounts(manifest: CleanupManifest) {
  return Object.fromEntries(
    CLEANUP_TABLES.map((spec) => [
      spec.table,
      manifest.records[spec.table].length,
    ]),
  );
}

function validManifestSkeleton(): CleanupManifest {
  const expectedBeforeCounts = Object.fromEntries(
    [
      "ai_llm_reservations",
      "ai_response_cache",
      "ai_usage",
      "anonymous_identity_claims",
      "approved_content_imports",
      "attempts",
      "audit_events",
      "feedback_reports",
      "hints",
      "misconceptions",
      "question_approval_history",
      "question_lifecycle_events",
      "question_patterns",
      "question_student_availability",
      "question_version_inspections",
      "question_version_lifecycle",
      "question_versions",
      "questions",
      "retrieval_chunks",
      "roles",
      "schema_migrations",
      "solution_steps",
      "student_content_availability_events",
      "student_progress",
      "topic_student_availability",
      "topics",
      "tutor_sessions",
      "user_roles",
      "users",
    ].map((table) => [table, 1]),
  );
  return {
    actorUserId: PROFESSOR,
    artifactVersion: 1,
    changeTicket: "PILOT-CLEANUP-2026-09-04",
    expectedBeforeCounts,
    identities: {
      pilotTestUserIds: [PILOT],
      retainedUserIds: [PROFESSOR, STAFF],
      staffTrialUserIds: [STAFF],
      syntheticQuestionIds: [SYNTHETIC],
      temporaryRoles: [],
    },
    ledger: { count: 21, fingerprint: "a".repeat(16), target: "production" },
    protectedCatalog: { publishedQuestionIds: [PUBLISHED] },
    records: {
      questions: [{ id: SYNTHETIC }],
      tutor_sessions: [{ id: "session-a" }],
      users: [{ id: PILOT }],
    },
    retentionDecision: "retain-audit-events-remove-synthetic-graph",
    target: "production",
  } as CleanupManifest;
}

async function productionShapedDatabase() {
  const database = new PGlite();
  openDatabases.push(database);
  const client = clientFor(database);
  const migrations = await loadMigrations(
    path.join(process.cwd(), "db/migrations"),
  );
  await runPendingMigrations({
    actor: "pilot-cleanup-test",
    allowDestructive: true,
    changeTicket: "PILOT-CLEANUP-TEST-LEDGER",
    client,
    confirmProduction: true,
    deploymentSha: "pilot-cleanup-test-sha",
    destructiveApprovedBy: "independent-cleanup-approver",
    migrations,
    target: "production",
  });
  return database;
}

async function seedPrePilotState(database: PGlite) {
  await database.exec(`
    insert into users (
      id, identity_provider, external_subject, email, display_name,
      user_type, status
    ) values
      ('${PROFESSOR}', 'clerk', 'professor-subject', 'professor@cleanup.invalid',
       'Course Professor', 'human', 'active'),
      ('${STAFF}', 'clerk', 'staff-subject', 'staff@cleanup.invalid',
       'Staff Trial Account', 'human', 'active'),
      ('${PILOT}', 'clerk', 'pilot-subject', 'pilot@cleanup.invalid',
       '{"role":"student","pilotTest":true} Student', 'human', 'active');
    insert into user_roles (user_id, role_id, granted_by_user_id) values
      ('${PROFESSOR}', 'professor', 'system:schema-migration'),
      ('${STAFF}', 'professor', 'system:schema-migration'),
      ('${STAFF}', 'student', 'system:schema-migration'),
      ('${PILOT}', 'student', 'system:schema-migration');
    insert into audit_events (
      actor_user_id, actor_subject, action, entity_type, entity_id, outcome
    ) values
      ('${PROFESSOR}', '${PROFESSOR}', 'auth.account_created', 'user', '${PROFESSOR}', 'success'),
      ('${PILOT}', '${PILOT}', 'auth.account_created', 'user', '${PILOT}', 'success');
    insert into topics (
      id, title, description, sort_order, week_number, module_ref, is_active
    ) values (
      'cleanup-topic', 'Cleanup topic', '', 7, 1, 'module-1', true
    );
    select set_config('app.current_user_id', '${PROFESSOR}', false);
    select set_config('app.current_creation_method', 'manual', false);
    select set_config('app.suppress_question_version', 'true', false);
    insert into questions (
      id, topic_id, title, prompt, difficulty, accepted_answers_json,
      answer_explanation, source_type, trust_level, review_status,
      visibility, originality_note, reviewed_by, reviewed_by_user_id,
      reviewed_at
    ) values
      ('${PUBLISHED}', 'cleanup-topic', 'Cleanup catalog question',
       'One of two equally likely outcomes is favorable. Probability?',
       'foundational', '["0.5"]'::jsonb, 'Divide one by two.',
       'professor_provided', 'public_original', 'needs_review', 'public',
       'Original public-safe cleanup test question.', 'Course Professor',
       '${PROFESSOR}', now()),
      ('${SYNTHETIC}', 'cleanup-topic', '[SYNTHETIC PILOT] Spinner check',
       'A spinner has four equal sectors. Probability of one sector?',
       'foundational', '["0.25"]'::jsonb, 'Divide one by four.',
       'professor_provided', 'public_original', 'needs_review', 'public',
       'Synthetic readiness fixture.', 'Course Professor',
       '${PROFESSOR}', now());
    insert into solution_steps (question_id, step_order, body) values
      ('${PUBLISHED}', 1, 'Compute 1 / 2 = 0.5.'),
      ('${SYNTHETIC}', 1, 'Compute 1 / 4 = 0.25.');
    insert into hints (question_id, hint_order, body) values
      ('${PUBLISHED}', 1, 'Count the favorable outcomes first.'),
      ('${SYNTHETIC}', 1, 'Count the sectors first.');
    insert into misconceptions (id, question_id, feedback, match_terms_json)
    values ('reversed-ratio', '${SYNTHETIC}', 'Divide favorable by total.', '["4"]'::jsonb);
    select set_config('app.suppress_question_version', 'false', false);
    select app_record_question_version('${PUBLISHED}');
    select app_record_question_version('${SYNTHETIC}');
  `);
  const versions = await database.query<{ id: number; question_id: string }>(
    "select id, question_id from question_versions order by id",
  );
  const versionOf = (questionId: string) => {
    const row = versions.rows.find((entry) => entry.question_id === questionId);
    if (!row) throw new Error(`Missing version for ${questionId}`);
    return row.id;
  };
  for (const questionId of [PUBLISHED, SYNTHETIC]) {
    for (const [action, expected] of [
      ["submit", "draft"],
      ["approve", "needs_review"],
      ["publish", "approved"],
    ]) {
      if (action === "approve" && questionId === SYNTHETIC) {
        // Mirrors Production: the professor inspected the exact version under
        // review before approving it.
        await database.query(
          "select app_record_question_version_inspection($1, $2, $3)",
          [SYNTHETIC, versionOf(SYNTHETIC), PROFESSOR],
        );
      }
      await database.query(
        `select * from app_transition_question_version(
           $1, $2, $3, $4, $5, $6
         )`,
        [
          questionId,
          versionOf(questionId),
          action,
          PROFESSOR,
          "Course Professor",
          expected,
        ],
      );
    }
  }
  await database.exec(`
    insert into tutor_sessions (
      id, user_id, question_id, creation_idempotency_key
    ) values
      ('cleanup-session-pilot', '${PILOT}', '${PUBLISHED}', 'pilot-key-1'),
      ('cleanup-session-pilot-synthetic', '${PILOT}', '${SYNTHETIC}', 'pilot-key-2'),
      ('cleanup-session-staff', '${STAFF}', '${PUBLISHED}', 'staff-key-1');
    insert into attempts (
      session_id, question_id, mode, answer_hash, answer_preview, source,
      verdict, estimated_tokens, idempotency_key
    ) values
      ('cleanup-session-pilot', '${PUBLISHED}', 'check', 'hash-1', '0.4', 'rule', 'incorrect', 0, 'attempt-1'),
      ('cleanup-session-pilot', '${PUBLISHED}', 'check', 'hash-2', '0.5', 'rule', 'correct', 0, 'attempt-2'),
      ('cleanup-session-staff', '${PUBLISHED}', 'check', 'hash-3', '0.5', 'rule', 'correct', 0, 'attempt-3');
    insert into ai_usage (scope, scope_key, date_key, interactions) values
      ('global', 'all', current_date, 3),
      ('session', 'session-hash-pilot', current_date, 1),
      ('student', 'student-hash-pilot', current_date, 1),
      ('student_question', 'student-hash-pilot:question-hash', current_date, 1);
    insert into ai_llm_reservations (
      id, session_id, student_key_hash, question_key_hash, request_hash,
      usage_date, idempotency_key, reserved_total_tokens, status,
      provider_calls, counts_toward_limit, limit_reason, accounted_at,
      expires_at
    ) values (
      'cleanup-reservation-pilot', 'cleanup-session-pilot',
      'student-hash-pilot', 'question-hash', 'request-hash-1',
      current_date, 'reservation-key-1', 1, 'blocked', 0, false,
      'session_limit', null, now() + interval '1 hour'
    );
    insert into ai_response_cache (
      request_hash, question_id, topic_id, mode, source, response_json,
      expires_at, student_key_hash
    ) values (
      'cache-request-hash', '${PUBLISHED}', 'cleanup-topic', 'hint', 'llm',
      '{"message":"cached"}'::jsonb, now() + interval '1 day', 'student-hash-pilot'
    );
    insert into feedback_reports (
      reporter_subject_hash, tutor_session_id, question_id,
      question_version_id, category, status, message, resolved_at,
      assigned_to_user_id, resolution_notes
    ) values (
      encode(sha256(convert_to('question-feedback:v1:user:${PILOT}', 'UTF8')), 'hex'),
      'cleanup-session-pilot', '${PUBLISHED}',
      (select question_version_id from tutor_sessions where id = 'cleanup-session-pilot'),
      'technical_problem', 'resolved', 'Test-only report.', now(),
      '${PROFESSOR}', 'Test-only resolution.'
    );
  `);
  await database.query(
    `select * from app_transition_question_version(
       $1, $2, 'unpublish', $3, $4, 'published', 'pilot_cleanup_fixture'
     )`,
    [SYNTHETIC, versionOf(SYNTHETIC), PROFESSOR, "Course Professor"],
  );
  await database.query(
    `select * from app_transition_question_version(
       $1, $2, 'archive', $3, $4, 'unpublished', 'pilot_cleanup_fixture'
     )`,
    [SYNTHETIC, versionOf(SYNTHETIC), PROFESSOR, "Course Professor"],
  );
}

async function runStatements(database: PGlite, statements: string[]) {
  for (const [index, statement] of statements.entries()) {
    try {
      await database.query(statement);
    } catch (error) {
      await database.query("rollback").catch(() => undefined);
      throw new Error(
        `statement ${index + 1}/${statements.length} failed: ${String(
          (error as Error).message,
        )}\n${statement.slice(0, 400)}`,
      );
    }
  }
}

function clientFor(database: PGlite): MigrationClient {
  return {
    exec(sql) {
      return database.exec(sql);
    },
    async query(sql, params = []) {
      const result =
        params.length > 0
          ? await database.query(sql, params as never[])
          : await database.query(sql);
      return { rows: result.rows as Array<Record<string, unknown>> };
    },
  };
}
