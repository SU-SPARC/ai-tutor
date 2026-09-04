#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BackupCustodyError,
  createAcceptanceRecord,
} from "./lib/backup-custody.mjs";
import { writeIntegrityEvidence } from "./lib/database-integrity-evidence.mjs";
import { recoveryObjectives } from "./lib/database-recovery-evidence.mjs";

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) {
    printUsage();
    return;
  }
  const restoreEvidence = JSON.parse(
    await readFile(path.resolve(options.restoreEvidence), "utf8"),
  );
  const record = createAcceptanceRecord({
    acceptedBy: process.env.RECOVERY_ACCEPTED_BY,
    changeTicket: process.env.RECOVERY_ACCEPTANCE_TICKET,
    objectives: recoveryObjectives(process.env),
    restoreEvidence,
    role: String(process.env.RECOVERY_ACCEPTANCE_ROLE ?? "").trim(),
  });
  let evidencePath;
  if (options.evidenceDir) {
    evidencePath = await writeIntegrityEvidence(options.evidenceDir, record);
  }
  if (options.json) {
    console.log(JSON.stringify({ ...record, evidencePath }, null, 2));
  } else {
    console.log(
      `Recovery objective acceptance: ${record.status.toUpperCase()}`,
    );
    console.log(`Role: ${record.acceptor.role}`);
    console.log(
      `Measured RPO hours: ${record.measured.recoveryPointAgeHours} (objective ${record.objectives.recoveryPointObjectiveHours})`,
    );
    console.log(
      `Measured RTO hours: ${record.measured.recoveryTimeHours} (objective ${record.objectives.recoveryTimeObjectiveHours})`,
    );
    if (evidencePath) console.log(`Evidence: ${evidencePath}`);
  }
  if (record.status !== "accepted") process.exitCode = 2;
  return record;
}

export function parseArguments(args) {
  if (args.includes("--help") || args.includes("-h")) return { help: true };
  const options = { json: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--restore-evidence") {
      options.restoreEvidence = requiredArgumentValue(args, ++index, argument);
    } else if (argument === "--evidence-dir") {
      options.evidenceDir = requiredArgumentValue(args, ++index, argument);
    } else if (argument === "--json") {
      options.json = true;
    } else {
      throw new BackupCustodyError(
        `Unknown acceptance option: ${argument}.`,
        "invalid_option",
      );
    }
  }
  if (!options.restoreEvidence) {
    throw new BackupCustodyError(
      "--restore-evidence <passed disposable restore artifact> is required.",
      "invalid_option",
    );
  }
  return options;
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

function printUsage() {
  console.log(`Usage:
  RECOVERY_ACCEPTED_BY="<named person>" RECOVERY_ACCEPTANCE_ROLE=<professor|it_operator|recovery_administrator> \\
  RECOVERY_ACCEPTANCE_TICKET=<ticket> [RECOVERY_TEST_RPO_HOURS=24] [RECOVERY_TEST_RTO_HOURS=24] \\
    npm run db:recovery:accept -- --restore-evidence <passed restore artifact> --evidence-dir docs/evidence/database-recovery

Records a named operator's acceptance of the measured recovery point age and
recovery time against the objectives. Only a fingerprint of the name is
retained. Exit 2 when the measured values exceed the objectives.`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code =
      error instanceof BackupCustodyError ? error.code : "operation_failed";
    console.error(
      `Recovery objective acceptance failed (${code}): ${String(error?.message ?? error)}`,
    );
    process.exitCode = 1;
  });
}
