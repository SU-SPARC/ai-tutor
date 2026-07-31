#!/usr/bin/env node

import path from "node:path"
import { fileURLToPath } from "node:url"

import pg from "pg"

import {
  RecoveryValidationError,
  assertConnectedRecoveryTarget,
  assertEmptyDisposableDatabase,
  assertRecoveryExecutionAuthorization,
  recoveryTargetFromUrl,
  resolveRecoveryArchive,
  runPgRestore,
  validateRestoredDatabase,
} from "./lib/database-recovery.mjs"
import { loadMigrations } from "./lib/database-migrations.mjs"

const { Pool } = pg
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args)
  if (options.help) {
    printUsage()
    return
  }

  const databaseUrl = process.env.RECOVERY_TEST_DATABASE_URL
  if (!databaseUrl) {
    throw new Error(
      "RECOVERY_TEST_DATABASE_URL is required; runtime, migration, import, and Production credentials are never used.",
    )
  }
  const target = recoveryTargetFromUrl(databaseUrl)

  if (options.mode === "plan") {
    printReport(
      {
        backupProviderVerified: false,
        mode: options.mode,
        nextStep:
          "Re-run with --restore or --validate-only and --confirm-target set to this fingerprint.",
        status: "planned",
        targetFingerprint: target.fingerprint,
      },
      options.json,
    )
    return
  }

  assertRecoveryExecutionAuthorization({
    actor: process.env.RECOVERY_TEST_ACTOR,
    changeTicket: process.env.RECOVERY_TEST_CHANGE_TICKET,
    confirmation: options.confirmation,
    target,
  })

  let archive
  let restore
  if (options.mode === "restore") {
    archive = await resolveRecoveryArchive(options.archive)
    await withRecoveryClient(databaseUrl, async (client) => {
      await assertConnectedRecoveryTarget(client, target)
      await assertEmptyDisposableDatabase(client)
    })
    restore = runPgRestore({ archive, databaseUrl })
  }

  const migrations = await loadMigrations(
    path.resolve(repositoryRoot, "db/migrations"),
  )
  const validation = await withRecoveryClient(databaseUrl, async (client) => {
    await assertConnectedRecoveryTarget(client, target)
    return withReadOnlyValidation(client, () =>
      validateRestoredDatabase({ client, migrations }),
    )
  })

  printReport(
    {
      actor: process.env.RECOVERY_TEST_ACTOR,
      backupProviderVerified: false,
      changeTicket: process.env.RECOVERY_TEST_CHANGE_TICKET,
      mode: options.mode,
      restore,
      status: "passed",
      targetFingerprint: target.fingerprint,
      validation,
    },
    options.json,
  )
}

export function parseArguments(args) {
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true }
  }

  const options = { json: false }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === "--archive") {
      options.archive = requiredArgumentValue(args, ++index, argument)
    } else if (argument === "--confirm-target") {
      options.confirmation = requiredArgumentValue(args, ++index, argument)
    } else if (argument === "--json") {
      options.json = true
    } else if (argument === "--plan") {
      setMode(options, "plan")
    } else if (argument === "--restore") {
      setMode(options, "restore")
    } else if (argument === "--validate-only") {
      setMode(options, "validate-only")
    } else {
      throw new Error(`Unknown recovery-test option: ${argument}.`)
    }
  }

  if (!options.mode) {
    throw new Error(
      "Choose exactly one of --plan, --restore, or --validate-only.",
    )
  }
  if (options.mode === "restore" && !options.archive) {
    throw new Error("--restore requires --archive.")
  }
  if (options.mode !== "restore" && options.archive) {
    throw new Error("--archive is accepted only with --restore.")
  }
  return options
}

function setMode(options, mode) {
  if (options.mode && options.mode !== mode) {
    throw new Error("Choose exactly one recovery-test mode.")
  }
  options.mode = mode
}

function requiredArgumentValue(args, index, option) {
  const value = args[index]
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`)
  }
  return value
}

async function withRecoveryClient(databaseUrl, work) {
  const pool = new Pool({
    application_name: "ai-tutor-disposable-recovery-test",
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 5_000,
    max: 1,
    query_timeout: 30_000,
    statement_timeout: 30_000,
  })
  const client = await pool.connect()

  try {
    return await work(client)
  } finally {
    client.release()
    await pool.end()
  }
}

async function withReadOnlyValidation(client, work) {
  await client.query(
    "begin transaction isolation level repeatable read read only",
  )
  try {
    const result = await work()
    await client.query("commit")
    return result
  } catch (error) {
    try {
      await client.query("rollback")
    } catch {
      // Preserve the validation failure; the pool is closed immediately.
    }
    throw error
  }
}

function printReport(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  console.log(`Recovery test: ${report.status}`)
  console.log(`Mode: ${report.mode}`)
  console.log(`Target fingerprint: ${report.targetFingerprint}`)
  console.log(
    `Provider backup verification: ${report.backupProviderVerified ? "verified" : "NOT VERIFIED"}`,
  )
  if (report.validation) {
    console.log(`Migration state: ${report.validation.migrationState}`)
    console.log(
      `Critical tables counted: ${Object.keys(report.validation.criticalRowCounts).length}`,
    )
  }
  if (report.nextStep) {
    console.log(report.nextStep)
  }
}

function printUsage() {
  console.log(`Usage:
  npm run db:recovery:test -- --plan [--json]
  npm run db:recovery:test -- --restore --archive <custom-format.dump> --confirm-target <fingerprint> [--json]
  npm run db:recovery:test -- --validate-only --confirm-target <fingerprint> [--json]

Environment (disposable target only):
  RECOVERY_TEST_DATABASE_URL   PostgreSQL URL for the disposable database
  RECOVERY_TEST_ACTOR          Named person or institutional job running the test
  RECOVERY_TEST_CHANGE_TICKET  Approved recovery-test ticket/evidence ID

The target host or database name must include restore, recovery, disposable,
sandbox, scratch, or test. This command never reads DATABASE_URL,
MIGRATION_DATABASE_URL, or CONTENT_IMPORT_DATABASE_URL.`)
}

function redactError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(
    /postgres(?:ql)?:\/\/[^\s]+/gi,
    "[REDACTED_DATABASE_URL]",
  )
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    if (error instanceof RecoveryValidationError) {
      if (process.argv.includes("--json")) {
        console.error(
          JSON.stringify(
            {
              backupProviderVerified: false,
              status: "failed",
              validation: error.report,
            },
            null,
            2,
          ),
        )
      } else {
        console.error(`Recovery validation failed: ${redactError(error)}`)
        for (const issue of error.issues) {
          console.error(`- ${issue.code}: ${issue.detail}`)
        }
      }
    } else {
      console.error(`Recovery test failed: ${redactError(error)}`)
    }
    process.exitCode = 1
  })
}
