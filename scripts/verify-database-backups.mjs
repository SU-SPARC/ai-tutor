#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BackupVerificationError,
  backupVerificationInputs,
  createBackupNotRunEvidence,
  fetchSupabaseBackupConfiguration,
  summarizeBackupConfiguration,
  writeBackupEvidence,
} from "./lib/database-backup-evidence.mjs";

const NOT_RUN_REASONS = new Set([
  "credential_unavailable",
  "expected_target_unavailable",
]);

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) {
    printUsage();
    return;
  }

  let inputs;
  try {
    inputs = backupVerificationInputs(process.env);
  } catch (error) {
    if (
      error instanceof BackupVerificationError &&
      NOT_RUN_REASONS.has(error.code) &&
      options.evidenceDir
    ) {
      const evidence = createBackupNotRunEvidence({
        generatedAt: new Date().toISOString(),
        reasonCode: error.code,
        target: options.target,
      });
      await writeBackupEvidence(options.evidenceDir, evidence);
      printReport(evidence, options.json);
      process.exitCode = 3;
      return;
    }
    throw error;
  }

  const configuration = await fetchSupabaseBackupConfiguration(inputs);
  const evidence = summarizeBackupConfiguration({
    configuration,
    expected: inputs.expected,
    target: options.target,
  });
  if (options.evidenceDir) {
    await writeBackupEvidence(options.evidenceDir, evidence);
  }
  printReport(evidence, options.json);
  if (evidence.findings.length > 0) {
    process.exitCode = 2;
  }
}

export function parseArguments(args) {
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true };
  }

  const options = { json: false, target: "production" };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      options.json = true;
    } else if (argument === "--evidence-dir") {
      options.evidenceDir = requiredArgumentValue(args, ++index, argument);
    } else if (argument === "--target") {
      options.target = requiredArgumentValue(args, ++index, argument);
    } else {
      throw new Error(`Unknown backup verification option: ${argument}.`);
    }
  }
  if (!/^[a-z]+$/.test(options.target)) {
    throw new Error("--target must be a lowercase environment label.");
  }
  return options;
}

function requiredArgumentValue(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function printReport(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (report.status === "not_run") {
    console.log("Provider backup verification: NOT RUN");
    console.log(`Target: ${report.target}`);
    console.log(`Reason: ${report.reason.message}`);
    return;
  }
  console.log(
    `Provider backup verification: ${report.status === "verified" ? "verified" : "FINDINGS"}`,
  );
  console.log(`Target: ${report.target}`);
  console.log(`Project hash: ${report.project.identityHash}`);
  console.log(`PITR enabled: ${report.automatedBackups.pitrEnabled}`);
  console.log(
    `Latest recovery point: ${report.automatedBackups.latestRecoveryPointAt ?? "none"}`,
  );
  console.log(
    `Retention days: ${report.automatedBackups.retentionDays ?? "unknown"}`,
  );
  console.log(
    `Organization owners: ${report.organization.ownerCount ?? "unverified"}`,
  );
  for (const finding of report.findings) {
    console.log(`- ${finding.severity} ${finding.code}: ${finding.detail}`);
  }
}

function printUsage() {
  console.log(`Usage:
  npm run db:backup:verify
  node scripts/verify-database-backups.mjs [--json] [--evidence-dir <dir>] [--target production]

Environment (read-only provider access only):
  SUPABASE_ACCESS_TOKEN           Personal/institutional Supabase Management API token
  BACKUP_PROVIDER_PROJECT_REF     Supabase project reference; only its safe hash is recorded
  BACKUP_EXPECTED_PROVIDER        supabase
  BACKUP_EXPECTED_PROJECT_HASH    Expected 16-character project safe hash
  BACKUP_EXPECTED_DATABASE_NAME   Expected database name

The command performs GET requests only, never prints the token or reference,
and writes a sanitized evidence artifact. Exit codes: 0 verified, 1 error,
2 findings, 3 not run because the credential or expected target is missing.`);
}

function redactError(error, environment = process.env) {
  let message = error instanceof Error ? error.message : String(error);
  for (const name of ["SUPABASE_ACCESS_TOKEN", "BACKUP_PROVIDER_PROJECT_REF"]) {
    const value = environment[name];
    if (value && value.trim()) {
      message = message.split(value.trim()).join(`[REDACTED_${name}]`);
    }
  }
  return message;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Provider backup verification failed: ${redactError(error)}`);
    process.exitCode = 1;
  });
}
