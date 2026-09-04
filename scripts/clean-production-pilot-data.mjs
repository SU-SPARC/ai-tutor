#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { parseFirstJsonValue } from "./lib/database-backup-evidence.mjs";
import { expectedCustodyTarget } from "./lib/database-custody.mjs";
import {
  fingerprintDatabaseUrl,
  safeHash,
  writeIntegrityEvidence,
} from "./lib/database-integrity-evidence.mjs";
import { runReadOnlyIntegrityAudit } from "./lib/database-integrity.mjs";
import { recoveryTargetFromUrl } from "./lib/database-recovery.mjs";
import {
  PILOT_CLEANUP_ARTIFACT,
  PilotCleanupError,
  buildCleanupManifest,
  buildCleanupSql,
  buildCleanupStatements,
  buildInventorySql,
  buildPlanSql,
  buildTemporaryRoleCleanupSql,
  cleanupApprovals,
  cleanupChangeContext,
  cleanupSqlSha256,
  firstJsonColumn,
  manifestSha256,
  requiredSafeLabel,
  sanitizeInventory,
  serializeManifest,
  summarizeManifest,
  validateCleanupManifest,
  verifyCleanupOutcome,
} from "./lib/pilot-data-cleanup.mjs";

const { Pool } = pg;
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const BACKUP_FRESHNESS_LIMIT_MS = 24 * 60 * 60 * 1000;
const SAFE_HASH_PATTERN = /^[0-9a-f]{16}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) {
    printUsage();
    return;
  }
  if (options.mode === "inspect") return runInspect(options);
  if (options.mode === "plan") return runPlan(options);
  if (options.mode === "rehearse") return runRehearse(options);
  return runExecute(options);
}

export function parseArguments(args) {
  if (args.includes("--help") || args.includes("-h")) return { help: true };
  const options = {
    confirmProduction: false,
    json: false,
    pilotTestUserIds: [],
    staffTrialUserIds: [],
    syntheticQuestionIds: [],
    temporaryRoleHashes: [],
  };
  let index = 0;
  if (["inspect", "plan", "rehearse", "execute"].includes(args[0])) {
    options.mode = args[0];
    index = 1;
  } else {
    throw new PilotCleanupError(
      "The first argument must be inspect, plan, rehearse, or execute.",
      "invalid_option",
    );
  }
  for (; index < args.length; index += 1) {
    const argument = args[index];
    const value = () => requiredArgumentValue(args, ++index, argument);
    if (argument === "--target") options.target = value();
    else if (argument === "--evidence-dir") options.evidenceDir = value();
    else if (argument === "--manifest") options.manifest = value();
    else if (argument === "--confirm-manifest-sha256")
      options.confirmManifestSha256 = value();
    else if (argument === "--rehearsal-evidence")
      options.rehearsalEvidence = value();
    else if (argument === "--backup-evidence") options.backupEvidence = value();
    else if (argument === "--confirm-production")
      options.confirmProduction = true;
    else if (argument === "--confirm-project-hash")
      options.confirmProjectHash = value();
    else if (argument === "--change-ticket") options.changeTicket = value();
    else if (argument === "--synthetic-question-id")
      options.syntheticQuestionIds.push(value());
    else if (argument === "--pilot-test-user-id")
      options.pilotTestUserIds.push(value());
    else if (argument === "--staff-trial-user-id")
      options.staffTrialUserIds.push(value());
    else if (argument === "--temporary-role-hash")
      options.temporaryRoleHashes.push(value());
    else if (argument === "--json") options.json = true;
    else
      throw new PilotCleanupError(
        `Unknown cleanup option: ${argument}.`,
        "invalid_option",
      );
  }
  if (!options.evidenceDir) {
    throw new PilotCleanupError(
      "--evidence-dir is required; every phase retains sanitized evidence.",
      "evidence_directory_required",
    );
  }
  if (["inspect", "plan", "execute"].includes(options.mode)) {
    if (options.target !== "production") {
      throw new PilotCleanupError(
        `${options.mode} requires --target production.`,
        "invalid_option",
      );
    }
  }
  if (options.mode === "plan") {
    if (!options.manifest) {
      throw new PilotCleanupError(
        "plan requires --manifest <path outside the repository>.",
        "invalid_option",
      );
    }
    if (
      options.syntheticQuestionIds.length +
        options.pilotTestUserIds.length +
        options.staffTrialUserIds.length +
        options.temporaryRoleHashes.length ===
      0
    ) {
      throw new PilotCleanupError(
        "plan requires at least one explicit identity to review.",
        "invalid_option",
      );
    }
    for (const hash of options.temporaryRoleHashes) {
      if (!SAFE_HASH_PATTERN.test(hash)) {
        throw new PilotCleanupError(
          "--temporary-role-hash must be a reviewed safe fingerprint.",
          "invalid_option",
        );
      }
    }
  }
  if (["rehearse", "execute"].includes(options.mode)) {
    if (
      !options.manifest ||
      !SHA256_PATTERN.test(options.confirmManifestSha256 ?? "")
    ) {
      throw new PilotCleanupError(
        `${options.mode} requires --manifest and --confirm-manifest-sha256 <sha256>.`,
        "manifest_confirmation_required",
      );
    }
    if (!options.backupEvidence) {
      throw new PilotCleanupError(
        `${options.mode} requires --backup-evidence <verified restore evidence>.`,
        "backup_evidence_required",
      );
    }
  }
  if (options.mode === "execute") {
    if (!options.rehearsalEvidence) {
      throw new PilotCleanupError(
        "execute requires --rehearsal-evidence <passed rehearsal evidence>.",
        "rehearsal_evidence_required",
      );
    }
    if (!options.confirmProduction) {
      throw new PilotCleanupError(
        "Production cleanup requires --confirm-production.",
        "production_confirmation_required",
      );
    }
    if (!SAFE_HASH_PATTERN.test(options.confirmProjectHash ?? "")) {
      throw new PilotCleanupError(
        "execute requires --confirm-project-hash <safe project fingerprint>.",
        "project_confirmation_required",
      );
    }
    requiredSafeLabel(options.changeTicket, "--change-ticket");
  }
  return options;
}

async function runInspect(options) {
  const expected = expectedCustodyTarget(process.env);
  const providerProjectRef = await readLinkedProviderProject(expected);
  const inventory = sanitizeInventory(
    firstJsonColumn(
      runOwnerSql({ providerProjectRef, sql: buildInventorySql() }),
      "inventory",
    ),
  );
  const evidence = {
    artifactVersion: 1,
    audit: PILOT_CLEANUP_ARTIFACT,
    before: inventory,
    expectedFingerprint: expected,
    generatedAt: new Date().toISOString(),
    phase: "inspected",
    readOnly: true,
    status: "inspected",
    target: "production",
    writesAttempted: 0,
  };
  const evidencePath = await writeIntegrityEvidence(
    options.evidenceDir,
    evidence,
  );
  printReport({ ...evidence, evidencePath }, options.json);
}

async function runPlan(options) {
  const context = cleanupChangeContext(process.env);
  const expected = expectedCustodyTarget(process.env);
  const providerProjectRef = await readLinkedProviderProject(expected);
  const manifestPath = await resolveManifestOutputPath(options.manifest);
  const plan = firstJsonColumn(
    runOwnerSql({
      providerProjectRef,
      sql: buildPlanSql({
        actorUserId: context.actorUserId,
        pilotTestUserIds: options.pilotTestUserIds,
        staffTrialUserIds: options.staffTrialUserIds,
        syntheticQuestionIds: options.syntheticQuestionIds,
      }),
    }),
    "plan",
  );
  const before = sanitizeInventory(plan.inventory);
  let manifest;
  try {
    manifest = buildCleanupManifest({
      changeTicket: context.changeTicket,
      context: {
        actorUserId: context.actorUserId,
        pilotTestUserIds: options.pilotTestUserIds,
        staffTrialUserIds: options.staffTrialUserIds,
        syntheticQuestionIds: options.syntheticQuestionIds,
      },
      plan,
      retentionDecision: context.retentionDecision,
      temporaryRoleHashes: options.temporaryRoleHashes,
    });
  } catch (error) {
    if (error instanceof PilotCleanupError && error.code === "plan_rejected") {
      const evidence = {
        artifactVersion: 1,
        audit: PILOT_CLEANUP_ARTIFACT,
        before,
        changeTicket: context.changeTicket,
        expectedFingerprint: expected,
        generatedAt: new Date().toISOString(),
        phase: "planned",
        problems: error.problems,
        readOnly: true,
        retentionDecision: context.retentionDecision,
        status: "blocked",
        target: "production",
        writesAttempted: 0,
      };
      const evidencePath = await writeIntegrityEvidence(
        options.evidenceDir,
        evidence,
      );
      printReport({ ...evidence, evidencePath }, options.json);
      process.exitCode = 2;
      return;
    }
    throw error;
  }
  const manifestText = serializeManifest(manifest);
  await writeFile(manifestPath, manifestText, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  const cleanupSql = buildCleanupSql(manifest);
  const evidence = {
    artifactVersion: 1,
    audit: PILOT_CLEANUP_ARTIFACT,
    before,
    changeTicket: context.changeTicket,
    cleanupSqlSha256: cleanupSqlSha256(cleanupSql),
    expectedFingerprint: expected,
    generatedAt: new Date().toISOString(),
    manifest: summarizeManifest(manifest, manifestText),
    phase: "planned",
    readOnly: true,
    retentionDecision: context.retentionDecision,
    status: "planned",
    target: "production",
    writesAttempted: 0,
  };
  const evidencePath = await writeIntegrityEvidence(
    options.evidenceDir,
    evidence,
  );
  printReport({ ...evidence, evidencePath, manifestPath }, options.json);
}

async function runRehearse(options) {
  const context = cleanupChangeContext(process.env);
  const { manifest, manifestText } = await loadConfirmedManifest(
    options,
    context,
  );
  const backup = await loadBackupEvidence(options.backupEvidence);
  const databaseUrl = process.env.PILOT_CLEANUP_REHEARSAL_DATABASE_URL;
  if (!databaseUrl) {
    throw new PilotCleanupError(
      "PILOT_CLEANUP_REHEARSAL_DATABASE_URL is required; Production, runtime, migration, and operator credentials are never used for a rehearsal.",
      "rehearsal_target_required",
    );
  }
  const target = recoveryTargetFromUrl(databaseUrl);
  const source = fingerprintDatabaseUrl(databaseUrl);
  if (source.provider === "supabase") {
    throw new PilotCleanupError(
      "A rehearsal target can never be a provider-hosted database.",
      "rehearsal_target_not_disposable",
    );
  }
  const cleanupSql = buildCleanupSql(manifest);
  const sqlSha256 = cleanupSqlSha256(cleanupSql);
  const startedAt = new Date().toISOString();
  const outcome = await withClient(databaseUrl, async (client) => {
    const connected = await client.query(
      "select current_database()::text as database_name",
    );
    if (String(connected.rows[0]?.database_name ?? "") !== target.database) {
      throw new PilotCleanupError(
        "Connected rehearsal database differs from the configured target.",
        "rehearsal_target_mismatch",
      );
    }
    const before = sanitizeInventory(
      firstJsonColumn(await client.query(buildInventorySql()), "inventory"),
    );
    assertBeforeMatchesManifest(before, manifest);
    const cleanupStartedMs = Date.now();
    const statements = buildCleanupStatements(manifest);
    for (const [index, statement] of statements.entries()) {
      try {
        await client.query(statement);
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw new PilotCleanupError(
          `Rehearsal statement ${index + 1}/${statements.length} failed and the transaction rolled back: ${String(
            error?.message ?? error,
          )
            .replace(/postgres(?:ql)?:\/\/\S+/gi, "[REDACTED_DATABASE_URL]")
            .slice(0, 300)}`,
          "rehearsal_failed",
        );
      }
    }
    const cleanupDurationMs = Date.now() - cleanupStartedMs;
    const after = sanitizeInventory(
      firstJsonColumn(await client.query(buildInventorySql()), "inventory"),
    );
    const verification = verifyCleanupOutcome({ after, before, manifest });
    const ledgerTarget = after.ledger.targets[0];
    const audit = await runReadOnlyIntegrityAudit(client, {
      target: ledgerTarget,
    });
    return { after, audit, before, cleanupDurationMs, verification };
  });
  const passed =
    outcome.verification.status === "passed" &&
    outcome.audit.status === "clean";
  const evidence = {
    after: outcome.after,
    artifactVersion: 1,
    audit: PILOT_CLEANUP_ARTIFACT,
    backup: backup.summary,
    before: outcome.before,
    changeTicket: context.changeTicket,
    cleanupDurationMs: outcome.cleanupDurationMs,
    cleanupSqlSha256: sqlSha256,
    disposableMarker: target.disposableMarker,
    exerciseCompletedAt: new Date().toISOString(),
    exerciseStartedAt: startedAt,
    generatedAt: new Date().toISOString(),
    integrityAudit: summarizeAudit(outcome.audit),
    manifest: summarizeManifest(manifest, manifestText),
    phase: "rehearsed",
    retentionDecision: context.retentionDecision,
    status: passed ? "passed" : "failed",
    target: "rehearsal",
    targetFingerprint: target.fingerprint,
    temporaryRoles: "not_applicable_to_logical_restore",
    verification: outcome.verification,
    writesAttempted: 1,
  };
  const evidencePath = await writeIntegrityEvidence(
    options.evidenceDir,
    evidence,
  );
  printReport({ ...evidence, evidencePath }, options.json);
  if (!passed) process.exitCode = 2;
}

async function runExecute(options) {
  const context = cleanupChangeContext(process.env);
  const approvals = cleanupApprovals(process.env);
  const expected = expectedCustodyTarget(process.env);
  if (options.confirmProjectHash !== expected.projectIdentityHash) {
    throw new PilotCleanupError(
      "The independently confirmed project fingerprint does not match.",
      "project_confirmation_mismatch",
    );
  }
  if (
    requiredSafeLabel(options.changeTicket, "--change-ticket") !==
    context.changeTicket
  ) {
    throw new PilotCleanupError(
      "The command and environment change tickets differ.",
      "change_ticket_mismatch",
    );
  }
  const { manifest, manifestText } = await loadConfirmedManifest(
    options,
    context,
  );
  const backup = await loadBackupEvidence(options.backupEvidence);
  const rehearsal = await loadRehearsalEvidence(options.rehearsalEvidence, {
    backup,
    manifestSha256: manifestSha256(manifestText),
  });
  const cleanupSql = buildCleanupSql(manifest);
  const sqlSha256 = cleanupSqlSha256(cleanupSql);
  if (rehearsal.cleanupSqlSha256 !== sqlSha256) {
    throw new PilotCleanupError(
      "The rehearsed cleanup SQL differs from the SQL about to run.",
      "rehearsal_mismatch",
    );
  }
  const providerProjectRef = await readLinkedProviderProject(expected);
  const before = sanitizeInventory(
    firstJsonColumn(
      runOwnerSql({ providerProjectRef, sql: buildInventorySql() }),
      "inventory",
    ),
  );
  assertBeforeMatchesManifest(before, manifest);
  const startedAt = new Date().toISOString();
  const cleanupStartedMs = Date.now();
  runOwnerSql({ providerProjectRef, sql: cleanupSql });
  const cleanupDurationMs = Date.now() - cleanupStartedMs;
  const after = sanitizeInventory(
    firstJsonColumn(
      runOwnerSql({ providerProjectRef, sql: buildInventorySql() }),
      "inventory",
    ),
  );
  const verification = verifyCleanupOutcome({ after, before, manifest });
  const temporaryRoles = [];
  if (verification.status === "passed") {
    for (const role of manifest.identities.temporaryRoles) {
      const result = runOwnerSql({
        providerProjectRef,
        sql: buildTemporaryRoleCleanupSql(role),
      });
      const row = rowsOf(result)[0] ?? {};
      temporaryRoles.push({
        remainingNamedRoles: Number(row.remaining_named_roles ?? -1),
        remainingTemporaryRoles: Number(row.remaining_temporary_roles ?? -1),
        roleHash: role.hash,
      });
    }
  }
  const rolesClean = temporaryRoles.every(
    (role) => role.remainingNamedRoles === 0,
  );
  const passed = verification.status === "passed" && rolesClean;
  const evidence = {
    after,
    approvals,
    artifactVersion: 1,
    audit: PILOT_CLEANUP_ARTIFACT,
    backup: backup.summary,
    before,
    changeTicket: context.changeTicket,
    cleanupDurationMs,
    cleanupSqlSha256: sqlSha256,
    exerciseCompletedAt: new Date().toISOString(),
    exerciseStartedAt: startedAt,
    expectedFingerprint: expected,
    generatedAt: new Date().toISOString(),
    integrityAudit: "run_separately_with_select_only_credential",
    manifest: summarizeManifest(manifest, manifestText),
    phase: "cleaned",
    rehearsal: {
      cleanupSqlSha256: rehearsal.cleanupSqlSha256,
      generatedAt: rehearsal.generatedAt,
      integrityAuditStatus: rehearsal.integrityAudit?.status,
      targetFingerprint: rehearsal.targetFingerprint,
    },
    retentionDecision: context.retentionDecision,
    status: passed ? "cleaned" : "failed",
    target: "production",
    temporaryRoles,
    verification,
    writesAttempted: 1 + temporaryRoles.length,
  };
  const evidencePath = await writeIntegrityEvidence(
    options.evidenceDir,
    evidence,
  );
  printReport({ ...evidence, evidencePath }, options.json);
  if (!passed) process.exitCode = 2;
}

async function loadConfirmedManifest(options, context) {
  const manifestText = await readFile(path.resolve(options.manifest), "utf8");
  const sha256 = manifestSha256(manifestText);
  if (sha256 !== options.confirmManifestSha256) {
    throw new PilotCleanupError(
      "--confirm-manifest-sha256 does not match the manifest file.",
      "manifest_confirmation_mismatch",
    );
  }
  const manifest = validateCleanupManifest(JSON.parse(manifestText));
  if (
    manifest.changeTicket !== context.changeTicket ||
    manifest.retentionDecision !== context.retentionDecision ||
    manifest.actorUserId !== context.actorUserId
  ) {
    throw new PilotCleanupError(
      "The manifest ticket, retention decision, or actor differs from the environment attestations.",
      "manifest_context_mismatch",
    );
  }
  return { manifest, manifestText };
}

export function assertBeforeMatchesManifest(before, manifest) {
  const mismatches = Object.keys(manifest.expectedBeforeCounts).filter(
    (table) => before.counts[table] !== manifest.expectedBeforeCounts[table],
  );
  const catalogFingerprint = safeHash(
    manifest.protectedCatalog.publishedQuestionIds.join("|"),
  );
  if (before.publishedCatalog.fingerprint !== catalogFingerprint) {
    mismatches.push("published_catalog");
  }
  if (before.ledger.fingerprint !== manifest.ledger.fingerprint) {
    mismatches.push("ledger");
  }
  if (mismatches.length > 0) {
    throw new PilotCleanupError(
      `The database no longer matches the planned snapshot: ${mismatches.join(", ")}.`,
      "snapshot_mismatch",
    );
  }
}

export async function loadBackupEvidence(evidencePath) {
  const evidence = JSON.parse(
    await readFile(path.resolve(evidencePath), "utf8"),
  );
  const generatedAt = Date.parse(String(evidence.generatedAt ?? ""));
  if (
    evidence.exercise !== "disposable_database_restore" ||
    evidence.target !== "production" ||
    evidence.status !== "passed" ||
    evidence.mode !== "restore" ||
    !SHA256_PATTERN.test(String(evidence.archive?.sha256 ?? "")) ||
    !Number.isFinite(generatedAt)
  ) {
    throw new PilotCleanupError(
      "--backup-evidence must be a passed disposable restore of a verified Production archive.",
      "backup_evidence_invalid",
    );
  }
  if (Date.now() - generatedAt > BACKUP_FRESHNESS_LIMIT_MS) {
    throw new PilotCleanupError(
      "The verified backup is older than 24 hours; take and verify a fresh recoverable backup first.",
      "backup_evidence_stale",
    );
  }
  return {
    evidence,
    summary: {
      archiveSha256: String(evidence.archive.sha256),
      integrityAuditStatus: evidence.integrityAudit?.status ?? null,
      recoveryPointAt: evidence.recoveryPoint?.declaredAt ?? null,
      restoreEvidenceGeneratedAt: String(evidence.generatedAt),
      validationStatus: evidence.validation?.status ?? null,
    },
  };
}

export async function loadRehearsalEvidence(
  evidencePath,
  { backup, manifestSha256: expectedSha256 },
) {
  const evidence = JSON.parse(
    await readFile(path.resolve(evidencePath), "utf8"),
  );
  if (
    evidence.audit !== PILOT_CLEANUP_ARTIFACT ||
    evidence.phase !== "rehearsed" ||
    evidence.status !== "passed" ||
    evidence.target !== "rehearsal" ||
    evidence.integrityAudit?.status !== "clean" ||
    evidence.manifest?.sha256 !== expectedSha256 ||
    evidence.backup?.archiveSha256 !== backup.summary.archiveSha256
  ) {
    throw new PilotCleanupError(
      "--rehearsal-evidence must be a passed rehearsal of this exact manifest against the verified backup restore.",
      "rehearsal_evidence_invalid",
    );
  }
  return evidence;
}

async function resolveManifestOutputPath(manifestPath) {
  const resolved = path.resolve(manifestPath);
  const relative = path.relative(repositoryRoot, resolved);
  if (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    throw new PilotCleanupError(
      "The manifest holds explicit record identifiers and must be written outside the repository.",
      "manifest_inside_repository",
    );
  }
  if (await stat(resolved).catch(() => null)) {
    throw new PilotCleanupError(
      "The manifest path already exists; never overwrite a reviewed manifest.",
      "manifest_exists",
    );
  }
  return resolved;
}

async function readLinkedProviderProject(expected) {
  let linked;
  try {
    linked = JSON.parse(
      await readFile(
        path.join(repositoryRoot, "supabase/.temp/linked-project.json"),
        "utf8",
      ),
    );
  } catch {
    throw new PilotCleanupError(
      "The workspace has no valid linked Supabase project metadata.",
      "provider_project_unlinked",
    );
  }
  const providerProjectRef = String(linked?.ref ?? "");
  if (
    !/^[a-z]{20}$/.test(providerProjectRef) ||
    safeHash(providerProjectRef) !== expected.projectIdentityHash
  ) {
    throw new PilotCleanupError(
      "The linked provider project fingerprint differs from Production.",
      "database_target_mismatch",
    );
  }
  return providerProjectRef;
}

// Owner SQL runs through the project owner's authenticated Supabase CLI so no
// database password enters this process. The SQL travels in a private file
// and the project reference never reaches stdout, stderr, or evidence.
export function runOwnerSql({
  providerProjectRef,
  spawnSyncImpl = spawnSync,
  sql,
}) {
  const directory = mkdtempSync(path.join(tmpdir(), "pilot-cleanup-"));
  const file = path.join(directory, "statement.sql");
  let result;
  try {
    writeFileSync(file, sql, { encoding: "utf8", mode: 0o600 });
    result = spawnSyncImpl(
      "supabase",
      [
        "db",
        "query",
        "--linked",
        "--project-ref",
        providerProjectRef,
        "--file",
        file,
        "--output",
        "json",
      ],
      {
        encoding: "utf8",
        env: Object.fromEntries(
          ["HOME", "LANG", "PATH", "SUPABASE_ACCESS_TOKEN", "TMPDIR"].flatMap(
            (name) => (process.env[name] ? [[name, process.env[name]]] : []),
          ),
        ),
        maxBuffer: 64 * 1024 * 1024,
        stdio: "pipe",
      },
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
  if (result?.error || result?.status !== 0) {
    const detail = String(result?.stderr ?? result?.stdout ?? "")
      .split(providerProjectRef)
      .join("[REF]")
      .replace(/postgres(?:ql)?:\/\/\S+/gi, "[REDACTED_DATABASE_URL]")
      .split("\n")
      .filter(
        (line) => line.trim() && !/new version|recommend updating/i.test(line),
      )
      .join(" ")
      .slice(0, 400);
    throw new PilotCleanupError(
      `The authenticated provider database operation failed${detail ? `: ${detail}` : "."}`,
      "provider_database_operation_failed",
    );
  }
  try {
    return parseFirstJsonValue(result.stdout);
  } catch {
    return [];
  }
}

function rowsOf(output) {
  if (Array.isArray(output)) return output;
  if (output && Array.isArray(output.rows)) return output.rows;
  return [];
}

function summarizeAudit(audit) {
  return {
    findings: audit.checks
      .filter((check) => check.count > 0)
      .map((check) => ({ count: check.count, id: check.id })),
    generatedAt: audit.generatedAt,
    status: audit.status,
    summary: audit.summary,
    target: audit.target,
  };
}

async function withClient(databaseUrl, work) {
  const pool = new Pool({
    application_name: "ai-tutor-pilot-data-cleanup-rehearsal",
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 5_000,
    max: 1,
    query_timeout: 180_000,
    statement_timeout: 120_000,
  });
  const client = await pool.connect();
  try {
    return await work(client);
  } finally {
    client.release();
    await pool.end();
  }
}

function requiredArgumentValue(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new PilotCleanupError(
      `${option} requires a value.`,
      "invalid_option",
    );
  }
  return value;
}

function printReport(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(
    `Pilot data cleanup ${report.phase}: ${report.status.toUpperCase()}`,
  );
  console.log(`Target: ${report.target}`);
  if (report.changeTicket) console.log(`Change ticket: ${report.changeTicket}`);
  if (report.manifest?.sha256)
    console.log(`Manifest sha256: ${report.manifest.sha256}`);
  if (report.manifest?.totalRecords !== undefined)
    console.log(`Explicit records: ${report.manifest.totalRecords}`);
  if (report.cleanupSqlSha256)
    console.log(`Cleanup SQL sha256: ${report.cleanupSqlSha256}`);
  if (report.problems) console.log(`Problems: ${report.problems.join(", ")}`);
  if (report.verification)
    console.log(
      `Verification: ${report.verification.status}${report.verification.problems.length ? ` (${report.verification.problems.join(", ")})` : ""}`,
    );
  if (report.integrityAudit?.summary)
    console.log(
      `Integrity audit: ${report.integrityAudit.status} (${report.integrityAudit.summary.passedChecks}/${report.integrityAudit.summary.totalChecks})`,
    );
  if (report.manifestPath) console.log(`Manifest: ${report.manifestPath}`);
  if (report.evidencePath) console.log(`Evidence: ${report.evidencePath}`);
}

function printUsage() {
  console.log(`Usage:
  node scripts/clean-production-pilot-data.mjs inspect --target production \\
    --evidence-dir docs/evidence/pilot-data-cleanup

  node scripts/clean-production-pilot-data.mjs plan --target production \\
    --manifest <path outside the repository> \\
    --synthetic-question-id <id> --pilot-test-user-id <id> \\
    --staff-trial-user-id <id> --temporary-role-hash <safe hash> \\
    --evidence-dir docs/evidence/pilot-data-cleanup

  PILOT_CLEANUP_REHEARSAL_DATABASE_URL=<disposable restore> \\
  node scripts/clean-production-pilot-data.mjs rehearse \\
    --manifest <path> --confirm-manifest-sha256 <sha256> \\
    --backup-evidence <passed restore evidence> \\
    --evidence-dir docs/evidence/pilot-data-cleanup

  node scripts/clean-production-pilot-data.mjs execute --target production \\
    --manifest <path> --confirm-manifest-sha256 <sha256> \\
    --backup-evidence <passed restore evidence> \\
    --rehearsal-evidence <passed rehearsal evidence> \\
    --confirm-production --confirm-project-hash <safe hash> \\
    --change-ticket <ticket> --evidence-dir docs/evidence/pilot-data-cleanup

plan, rehearse, and execute require PILOT_CLEANUP_CHANGE_TICKET,
PILOT_CLEANUP_RETENTION_DECISION, and PILOT_CLEANUP_ACTOR_USER_ID. execute
additionally requires four distinct named approvals (data owner, privacy and
retention reviewer, IT operator, independent second reviewer), each with its
*_APPROVED=true attestation, the expected Production fingerprint, a verified
backup younger than 24 hours, and a passed rehearsal of the identical SQL.
Only explicit primary keys from the reviewed manifest are ever deleted.`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code =
      error instanceof PilotCleanupError ? error.code : "operation_failed";
    const detail =
      error instanceof PilotCleanupError
        ? error.message
        : String(error?.message ?? error).replace(
            /postgres(?:ql)?:\/\/\S+/gi,
            "[REDACTED_DATABASE_URL]",
          );
    console.error(`Pilot data cleanup failed: ${code}. ${detail}`);
    process.exitCode = 1;
  });
}
