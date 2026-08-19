#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
  ReviewCandidateImportValidationError,
  resolveReviewCandidateDatabaseUrl,
} from "./lib/review-candidate-import.mjs";
import {
  PROVENANCE_REPAIR_LOCK_ID,
  ProvenanceRepairError,
  applyProvenanceRepair,
  loadPublicReviewCandidateFixtures,
} from "./lib/review-candidate-provenance-repair.mjs";
import {
  getMigrationStatus,
  loadMigrations,
} from "./lib/database-migrations.mjs";

const { Pool } = pg;
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const TARGETS = new Set(["development", "production", "staging", "test"]);

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  if (options.mode === "apply" && options.target === "production") {
    if (!options.confirmProduction) {
      throw new Error("Production apply requires --confirm-production.");
    }
  }

  const databaseUrl = resolveReviewCandidateDatabaseUrl();
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL or POSTGRES_URL is required for provenance repair.",
    );
  }
  const fixtures = await loadPublicReviewCandidateFixtures(repositoryRoot);

  console.log(`Target: ${options.target}`);
  console.log(`Mode: ${options.mode}`);
  if (options.only) {
    console.log(`Restricted to: ${[...options.only].join(", ")}`);
  }

  const pool = new Pool({
    application_name: "ai-tutor-provenance-repair",
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 5_000,
    max: 1,
  });
  const client = await pool.connect();

  try {
    const migrations = await loadMigrations(
      path.resolve(repositoryRoot, "db/migrations"),
    );
    const migrationStatus = await getMigrationStatus(client, migrations);
    if (migrationStatus.state !== "current") {
      throw new Error(
        `Database migration status is ${migrationStatus.state}; provenance repair requires the complete checksum-clean migration history.`,
      );
    }

    await client.query("select pg_advisory_lock($1::bigint)", [
      PROVENANCE_REPAIR_LOCK_ID,
    ]);
    try {
      const report = await applyProvenanceRepair({
        client,
        dryRun: options.mode === "check",
        fixtures,
        only: options.only,
        target: options.target,
      });
      printReport(report);
    } finally {
      await client.query("select pg_advisory_unlock($1::bigint)", [
        PROVENANCE_REPAIR_LOCK_ID,
      ]);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

function parseArguments(args) {
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true };
  }

  const options = { confirmProduction: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--apply") {
      setMode(options, "apply");
    } else if (argument === "--check") {
      setMode(options, "check");
    } else if (argument === "--confirm-production") {
      options.confirmProduction = true;
    } else if (argument === "--target") {
      options.target = requiredValue(args, ++index, argument);
    } else if (argument === "--only") {
      options.only ??= new Set();
      options.only.add(requiredValue(args, ++index, argument));
    } else {
      throw new Error(`Unknown provenance repair option: ${argument}.`);
    }
  }

  if (!options.mode) {
    throw new Error("Choose exactly one of --check or --apply.");
  }
  if (!TARGETS.has(options.target)) {
    throw new Error(
      "--target must be one of development, test, staging, or production.",
    );
  }
  return options;
}

function setMode(options, mode) {
  if (options.mode && options.mode !== mode) {
    throw new Error("Choose exactly one of --check or --apply.");
  }
  options.mode = mode;
}

function requiredValue(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function printReport(report) {
  console.log(`Committed: ${report.committed ? "yes" : "no"}`);
  console.log(`Already correct: ${report.alreadyCorrect}`);
  console.log(`Absent from database: ${report.absent.length}`);
  console.log(`Repairable: ${report.selected.length}`);
  for (const id of report.selected) {
    console.log(`  - ${id}`);
  }
  if (report.repaired.length > 0) {
    console.log(`Corrected versions appended: ${report.repaired.length}`);
    for (const entry of report.repaired) {
      console.log(
        `  - ${entry.id}: version ${entry.previousVersionId} (${entry.previousLifecycleState}) superseded by ${entry.versionId} (needs_review)`,
      );
    }
  }
  if (report.blocked.length > 0) {
    console.log(`Blocked and untouched: ${report.blocked.length}`);
    for (const entry of report.blocked) {
      console.log(`  - ${entry.id}: ${entry.reason}`);
    }
  }
}

function printUsage() {
  console.log(`Repair review-candidate source provenance.

Imported drafts that claim pattern_derived_original without a linked
catalogued pattern can never satisfy the publication quality gate. This command
corrects them to the truthful generated_original classification by appending a
new immutable version through the lifecycle system. It never rewrites a stored
snapshot, never invents a pattern ID, and never relaxes the publication gate.

Usage:
  npm run db:repair:review-candidate-provenance -- --target <env> --check
  npm run db:repair:review-candidate-provenance -- --target <env> --apply
  npm run db:repair:review-candidate-provenance -- --target production --apply --confirm-production

Options:
  --check                 Report the plan and roll back without writing.
  --apply                 Append corrected versions in one transaction.
  --only <question-id>    Restrict the apply to one ID (repeatable).
  --target <env>          development | test | staging | production.
  --confirm-production    Required with --apply against production.
`);
}

main().catch((error) => {
  if (
    error instanceof ProvenanceRepairError ||
    error instanceof ReviewCandidateImportValidationError
  ) {
    console.error(error.message);
    for (const issue of error.issues) {
      console.error(`- ${issue}`);
    }
    process.exitCode = 1;
    return;
  }
  console.error(`Provenance repair failed: ${error.message}`);
  process.exitCode = 1;
});
