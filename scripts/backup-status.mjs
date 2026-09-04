#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BACKUP_CUSTODY_POLICY,
  BACKUP_CUSTODY_STATUS_AUDIT,
  BackupCustodyError,
  backupCustodyOwnership,
  evaluateBackupCustody,
  importBackupPublicKey,
  inventoryArchives,
  latestProviderVerification,
  readLedger,
  resolveCustodyStore,
} from "./lib/backup-custody.mjs";
import { writeIntegrityEvidence } from "./lib/database-integrity-evidence.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export async function main(args = process.argv.slice(2), dependencies = {}) {
  const options = parseArguments(args);
  if (options.help) {
    printUsage();
    return;
  }
  const environment = dependencies.environment ?? process.env;
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  const now = dependencies.now ?? new Date();
  let store;
  try {
    store = resolveCustodyStore({ environment, repositoryRoot });
  } catch (error) {
    if (error instanceof BackupCustodyError && options.evidenceDir) {
      const evidence = notRunEvidence(error.code, now);
      const evidencePath = await writeIntegrityEvidence(
        options.evidenceDir,
        evidence,
      );
      printReport({ ...evidence, evidencePath }, options.json);
      process.exitCode = 3;
      return evidence;
    }
    throw error;
  }
  const approvedKey = environment.BACKUP_ENCRYPTION_PUBLIC_KEY
    ? importBackupPublicKey(environment.BACKUP_ENCRYPTION_PUBLIC_KEY)
    : null;
  const { entries, malformedLines } = await readLedger(store);
  const archives = await inventoryArchives(store, entries);
  const providerEvidence = await latestProviderVerification(
    path.resolve(repositoryRoot, options.providerEvidenceDir),
  );
  const ownership = backupCustodyOwnership(environment);
  const evaluation = evaluateBackupCustody({
    approvedKeyFingerprint: approvedKey?.fingerprint ?? null,
    archives,
    entries,
    malformedLines,
    now,
    ownership,
    providerEvidence,
  });
  const evidence = {
    approvedKeyFingerprint: approvedKey?.fingerprint ?? null,
    artifactVersion: 1,
    audit: BACKUP_CUSTODY_STATUS_AUDIT,
    counts: evaluation.counts,
    findings: evaluation.findings,
    generatedAt: now.toISOString(),
    latestBackup: evaluation.latestBackup,
    missingDays: evaluation.missingDays,
    ownership,
    policy: BACKUP_CUSTODY_POLICY,
    provider: providerEvidence,
    readOnly: true,
    status: evaluation.status,
    summary: {
      criticalFindings: evaluation.findings.filter(
        (finding) => finding.severity === "critical",
      ).length,
      findingCount: evaluation.findings.length,
    },
    target: "production",
    writesAttempted: 0,
  };
  let evidencePath;
  if (options.evidenceDir) {
    evidencePath = await writeIntegrityEvidence(options.evidenceDir, evidence);
  }
  let alert = null;
  if (evaluation.findings.length > 0 && environment.BACKUP_ALERT_WEBHOOK_URL) {
    alert = await sendAlert({
      evidence,
      fetchImpl,
      webhookUrl: environment.BACKUP_ALERT_WEBHOOK_URL,
    });
  }
  printReport({ ...evidence, alert, evidencePath }, options.json);
  if (evaluation.findings.length > 0) process.exitCode = 2;
  return evidence;
}

export function parseArguments(args) {
  if (args.includes("--help") || args.includes("-h")) return { help: true };
  const options = {
    json: false,
    providerEvidenceDir: "docs/evidence/database-backups",
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--evidence-dir") {
      options.evidenceDir = requiredArgumentValue(args, ++index, argument);
    } else if (argument === "--provider-evidence-dir") {
      options.providerEvidenceDir = requiredArgumentValue(
        args,
        ++index,
        argument,
      );
    } else if (argument === "--json") {
      options.json = true;
    } else {
      throw new BackupCustodyError(
        `Unknown backup status option: ${argument}.`,
        "invalid_option",
      );
    }
  }
  return options;
}

// The alert carries finding codes, counts, and timestamps only: no path,
// digest, host, credential, or archive content.
export async function sendAlert({ evidence, fetchImpl, webhookUrl }) {
  const payload = {
    audit: evidence.audit,
    criticalFindings: evidence.summary.criticalFindings,
    findingCodes: evidence.findings.map((finding) => finding.code),
    generatedAt: evidence.generatedAt,
    latestRecoveryPointAt: evidence.latestBackup?.recoveryPointAt ?? null,
    status: evidence.status,
    target: evidence.target,
  };
  try {
    const response = await fetchImpl(webhookUrl, {
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    });
    return {
      delivered: Boolean(response?.ok),
      status: response?.status ?? null,
    };
  } catch {
    return { delivered: false, status: null };
  }
}

function notRunEvidence(reasonCode, now) {
  return {
    artifactVersion: 1,
    audit: BACKUP_CUSTODY_STATUS_AUDIT,
    findings: [],
    generatedAt: now.toISOString(),
    readOnly: true,
    reason: { code: reasonCode },
    status: "not_run",
    target: "production",
    writesAttempted: 0,
  };
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

function printReport(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Backup custody status: ${report.status.toUpperCase()}`);
  if (report.reason) console.log(`Reason: ${report.reason.code}`);
  if (report.latestBackup) {
    console.log(
      `Latest recovery point: ${report.latestBackup.recoveryPointAt} (${report.latestBackup.ageHours} h ago)`,
    );
  }
  if (report.counts) {
    console.log(
      `Completed exports: ${report.counts.completed}; failed runs: ${report.counts.failed}`,
    );
  }
  if (report.ownership) console.log(`Ownership: ${report.ownership.status}`);
  if (report.provider)
    console.log(`Provider backups: ${report.provider.status}`);
  for (const finding of report.findings ?? []) {
    console.log(`- ${finding.severity} ${finding.code}: ${finding.detail}`);
  }
  if (report.alert) console.log(`Alert delivered: ${report.alert.delivered}`);
  if (report.evidencePath) console.log(`Evidence: ${report.evidencePath}`);
}

function printUsage() {
  console.log(`Usage:
  npm run db:backup:status -- [--evidence-dir docs/evidence/backup-custody] [--provider-evidence-dir docs/evidence/database-backups] [--json]

Environment:
  BACKUP_CUSTODY_DIR             Custody store to inspect (read-only)
  BACKUP_ENCRYPTION_PUBLIC_KEY   Approved recovery public key; archives must be encrypted to it
  BACKUP_INSTITUTIONAL_OWNER_1/2, BACKUP_OPERATOR   Named custody people (fingerprinted only)
  BACKUP_ALERT_WEBHOOK_URL       Optional; receives finding codes and counts only

Detects stale, missing, failed, incomplete, corrupted, mis-keyed, or
unpruned exports, unrecorded ownership or region, and inactive provider
backups. Exit codes: 0 verified, 1 error, 2 findings, 3 store unavailable.`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code =
      error instanceof BackupCustodyError ? error.code : "operation_failed";
    console.error(
      `Backup custody status failed (${code}): ${String(error?.message ?? error)}`,
    );
    process.exitCode = 1;
  });
}
