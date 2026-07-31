#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
  SUPPORTED_REPAIR_ACTIONS,
  assertIntegrityDatabaseTarget,
  formatIntegrityReport,
  repairDatabaseIntegrity,
  runReadOnlyIntegrityAudit,
} from "./lib/database-integrity.mjs";
import {
  getMigrationStatus,
  loadMigrations,
} from "./lib/database-migrations.mjs";

const { Pool } = pg;
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) {
    printUsage();
    return;
  }

  const databaseUrl = resolveDatabaseUrl(options.mode);
  validatePostgresUrl(databaseUrl);
  const pool = new Pool({
    application_name: `ai-tutor-database-integrity-${options.mode}`,
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 5_000,
    max: 1,
    query_timeout: 65_000,
    statement_timeout: 60_000,
  });
  const client = await pool.connect();

  try {
    const migrations = await loadMigrations(
      path.resolve(repositoryRoot, "db/migrations"),
    );
    const migrationStatus = await getMigrationStatus(client, migrations);
    if (migrationStatus.state !== "current") {
      throw new Error(
        `Database migration status is ${migrationStatus.state}; integrity checks require the complete checksum-clean migration history.`,
      );
    }
    await assertIntegrityDatabaseTarget(client, options.target);

    const report =
      options.mode === "repair"
        ? await repairDatabaseIntegrity(client, {
            actions: options.actions,
            actorUserId: process.env.INTEGRITY_REPAIR_ACTOR_USER_ID,
            changeTicket: process.env.INTEGRITY_REPAIR_CHANGE_TICKET,
            confirmProduction: options.confirmProduction,
            confirmRepair: options.confirmRepair,
            target: options.target,
          })
        : await runReadOnlyIntegrityAudit(client, {
            target: options.target,
          });

    printReport(report, options.json);
    const findings =
      report.mode === "repair"
        ? report.after.summary.findings
        : report.summary.findings;
    if (findings > 0) {
      process.exitCode = 2;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

export function parseArguments(args) {
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true };
  }

  const options = {
    actions: [],
    confirmProduction: false,
    confirmRepair: false,
    json: false,
    mode: "audit",
  };
  let index = 0;
  if (args[0] === "audit" || args[0] === "repair") {
    options.mode = args[0];
    index = 1;
  }

  for (; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--action") {
      options.actions.push(requiredArgumentValue(args, ++index, argument));
    } else if (argument === "--confirm-production") {
      options.confirmProduction = true;
    } else if (argument === "--confirm-repair") {
      options.confirmRepair = true;
    } else if (argument === "--json") {
      options.json = true;
    } else if (argument === "--target") {
      options.target = requiredArgumentValue(args, ++index, argument);
    } else {
      throw new Error(`Unknown database-integrity option: ${argument}.`);
    }
  }

  if (!options.target) {
    throw new Error("--target is required.");
  }
  if (options.mode === "audit") {
    if (
      options.actions.length > 0 ||
      options.confirmProduction ||
      options.confirmRepair
    ) {
      throw new Error(
        "Repair options are not accepted in read-only audit mode.",
      );
    }
  } else {
    if (!options.confirmRepair) {
      throw new Error("Repair mode requires --confirm-repair.");
    }
    if (options.actions.length === 0) {
      throw new Error("Repair mode requires at least one --action.");
    }
  }
  return options;
}

function resolveDatabaseUrl(mode) {
  const variable =
    mode === "repair"
      ? "INTEGRITY_REPAIR_DATABASE_URL"
      : "INTEGRITY_DATABASE_URL";
  const value = process.env[variable];
  if (!value) {
    throw new Error(`${variable} is required for ${mode} mode.`);
  }
  return value;
}

function validatePostgresUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Integrity database URL must be a valid PostgreSQL URL.");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    throw new Error(
      "Integrity database URL must use postgres:// or postgresql://.",
    );
  }
}

function printReport(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(formatIntegrityReport(report));
}

function requiredArgumentValue(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function printUsage() {
  console.log(`Usage:
  npm run db:integrity -- audit --target <test|staging|production> [--json]
  npm run db:integrity -- repair --target <test|staging|production> \\
    --action <action> --confirm-repair [--confirm-production] [--json]

Audit environment:
  INTEGRITY_DATABASE_URL              Read-only audit credential

Repair environment:
  INTEGRITY_REPAIR_DATABASE_URL       Separately controlled repair credential
  INTEGRITY_REPAIR_ACTOR_USER_ID      Active human professor/admin application user ID
  INTEGRITY_REPAIR_CHANGE_TICKET      Approved repair ticket

Repair actions:
${SUPPORTED_REPAIR_ACTIONS.map((action) => `  - ${action}`).join("\n")}

Audit is the default mode and always uses a read-only transaction. Repair mode
never runs automatically and requires the explicit command, action, confirmation,
actor, ticket, and separate credential. Production repair also requires
--confirm-production.`);
}

function redactError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(
    /postgres(?:ql)?:\/\/[^\s]+/gi,
    "[REDACTED_DATABASE_URL]",
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Database integrity command failed: ${redactError(error)}`);
    process.exitCode = 1;
  });
}
