#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
  REVIEW_CANDIDATE_IMPORT_LOCK_ID,
  ReviewCandidateImportValidationError,
  importPublicReviewCandidates,
  loadPublicReviewCandidateFixtures,
  resolveReviewCandidateDatabaseUrl,
} from "./lib/review-candidate-import.mjs";
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
      "DATABASE_URL or POSTGRES_URL is required for review-candidate import.",
    );
  }
  const connectionString = normalizeDatabaseUrl(databaseUrl);
  const fixtures = await loadPublicReviewCandidateFixtures(repositoryRoot);

  console.log(`Target: ${options.target}`);
  console.log(`Mode: ${options.mode}`);
  console.log(`Topics in repository: ${fixtures.topics.length}`);
  console.log(`Candidates in repository: ${fixtures.candidates.length}`);

  const pool = new Pool({
    application_name: "ai-tutor-review-candidate-import",
    connectionString,
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
        `Database migration status is ${migrationStatus.state}; review-candidate import requires the complete checksum-clean migration history.`,
      );
    }

    await client.query("select pg_advisory_lock($1::bigint)", [
      REVIEW_CANDIDATE_IMPORT_LOCK_ID,
    ]);
    try {
      const report = await importPublicReviewCandidates({
        client,
        dryRun: options.mode === "check",
        fixtures,
        target: options.target,
      });
      printReport(report);
    } finally {
      await client.query("select pg_advisory_unlock($1::bigint)", [
        REVIEW_CANDIDATE_IMPORT_LOCK_ID,
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
    } else {
      throw new Error(`Unknown review-candidate import option: ${argument}.`);
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

function normalizeDatabaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    throw new Error("DATABASE_URL must use postgres:// or postgresql://.");
  }
  if (
    parsed.searchParams.get("sslmode") === "require" &&
    !parsed.searchParams.has("uselibpqcompat")
  ) {
    parsed.searchParams.set("uselibpqcompat", "true");
  }
  return parsed.toString();
}

function printReport(report) {
  console.log(`Committed: ${report.committed ? "yes" : "no"}`);
  console.log(
    `Topics: ${report.topics.total} total, ${report.topics.inserted} inserted, ${report.topics.updated} updated, ${report.topics.skipped} skipped`,
  );
  console.log(
    `Candidates: ${report.candidates.total} total, ${report.candidates.inserted} inserted, ${report.candidates.skipped} skipped, ${report.candidates.preservedProfessorReviewed} preserved professor-reviewed`,
  );
}

function printUsage() {
  console.log(`Usage:
  npm run db:import:review-candidates -- --target <development|test|staging|production> --check
  npm run db:import:review-candidates -- --target <development|test|staging|production> --apply

Options:
  --apply               Import topics and missing review candidates transactionally
  --check               Validate fixtures and report the database plan without writing
  --confirm-production  Required with --target production --apply
  --target              Required target environment label

DATABASE_URL or the managed-integration POSTGRES_URL is required. The command
never prints it or any credentials.`);
}

function redactError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(
    /postgres(?:ql)?:\/\/[^\s]+/gi,
    "[REDACTED_DATABASE_URL]",
  );
}

main().catch((error) => {
  if (error instanceof ReviewCandidateImportValidationError) {
    console.error("Review-candidate import rejected:");
    for (const issue of error.issues) {
      console.error(`- ${redactError(issue)}`);
    }
  } else {
    console.error(`Review-candidate import failed: ${redactError(error)}`);
  }
  process.exitCode = 1;
});
