#!/usr/bin/env node

import path from "node:path"
import { fileURLToPath } from "node:url"

import pg from "pg"

import {
  SUPPORTED_MIGRATION_COMMANDS,
  deploymentCheckExitCode,
  getMigrationStatus,
  loadMigrations,
  normalizeMigrationDatabaseUrl,
  runPendingMigrations,
} from "./lib/database-migrations.mjs"

const { Pool } = pg
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)

async function main() {
  const options = parseArguments(process.argv.slice(2))

  if (options.help) {
    printUsage()
    return
  }

  const migrationsDirectory = path.resolve(repositoryRoot, "db/migrations")
  const migrations = await loadMigrations(migrationsDirectory)
  const databaseUrl = normalizeMigrationDatabaseUrl(
    resolveDatabaseUrl(options.command),
  )
  validatePostgresUrl(databaseUrl)

  const pool = new Pool({
    application_name: "ai-tutor-database-migrations",
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 5_000,
    max: 1,
  })
  const client = await pool.connect()

  try {
    if (options.command === "up") {
      const result = await runPendingMigrations({
        actor: process.env.MIGRATION_ACTOR,
        allowDestructive: options.allowDestructive,
        changeTicket: process.env.MIGRATION_CHANGE_TICKET,
        client,
        confirmProduction: options.confirmProduction,
        deploymentSha:
          process.env.MIGRATION_DEPLOYMENT_SHA ??
          process.env.GITHUB_SHA ??
          process.env.VERCEL_GIT_COMMIT_SHA,
        destructiveApprovedBy: process.env.MIGRATION_DESTRUCTIVE_APPROVED_BY,
        migrations,
        target: options.target,
      })

      printResult(
        {
          applied: result.applied,
          command: options.command,
          state: result.status.state,
        },
        options.json,
      )
      return
    }

    const status = await getMigrationStatus(client, migrations)
    printResult(
      {
        ...status,
        command: options.command,
      },
      options.json,
    )

    if (options.command === "check") {
      process.exitCode = deploymentCheckExitCode(status)
    }
  } finally {
    client.release()
    await pool.end()
  }
}

function parseArguments(args) {
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true }
  }

  const command = args[0]
  if (!SUPPORTED_MIGRATION_COMMANDS.includes(command)) {
    throw new Error(
      `Migration command must be one of: ${SUPPORTED_MIGRATION_COMMANDS.join(", ")}.`,
    )
  }

  const options = {
    allowDestructive: false,
    command,
    confirmProduction: false,
    json: false,
  }

  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index]

    if (argument === "--allow-destructive") {
      options.allowDestructive = true
    } else if (argument === "--confirm-production") {
      options.confirmProduction = true
    } else if (argument === "--json") {
      options.json = true
    } else if (argument === "--target") {
      options.target = requiredArgumentValue(args, ++index, argument)
    } else {
      throw new Error(`Unknown migration option: ${argument}.`)
    }
  }

  if (command === "up" && !options.target) {
    throw new Error("The up command requires --target.")
  }

  return options
}

function requiredArgumentValue(args, index, option) {
  const value = args[index]
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`)
  }
  return value
}

function resolveDatabaseUrl(command) {
  if (command === "up") {
    if (!process.env.MIGRATION_DATABASE_URL) {
      throw new Error(
        "MIGRATION_DATABASE_URL is required to apply migrations; DATABASE_URL is never used for writes.",
      )
    }
    return process.env.MIGRATION_DATABASE_URL
  }

  const databaseUrl =
    process.env.MIGRATION_DATABASE_URL ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL
  if (!databaseUrl) {
    throw new Error(
      "MIGRATION_DATABASE_URL, DATABASE_URL, or a read-only POSTGRES_URL is required to check migration status.",
    )
  }
  return databaseUrl
}

function validatePostgresUrl(value) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error("Database URL must be a valid PostgreSQL URL.")
  }

  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    throw new Error("Database URL must use postgres:// or postgresql://.")
  }
}

function printResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  if (result.command === "up") {
    if (result.applied.length === 0) {
      console.log("Database is current; no migrations were applied.")
      return
    }

    console.log(`Applied ${result.applied.length} migration(s):`)
    for (const migration of result.applied) {
      console.log(`- ${migration.filename} (${migration.executionMs}ms)`)
    }
    return
  }

  console.log(`Migration status: ${result.state}`)
  console.log(`Applied: ${result.applied.length}/${result.total}`)

  for (const migration of result.pending) {
    const safety = migration.destructive ? " [DESTRUCTIVE]" : ""
    console.log(`- PENDING ${migration.filename}${safety}`)
  }

  for (const issue of result.issues) {
    console.error(`- DRIFT ${issue.message}`)
  }
}

function printUsage() {
  console.log(`Usage:
  npm run db:migrate:status [-- --json]
  npm run db:migrate:check [-- --json]
  npm run db:migrate -- --target <development|test|staging|production>

Options:
  --allow-destructive   Permit a declared destructive migration after approval checks
  --confirm-production Confirm that the target is Production
  --json               Emit machine-readable status
  --target             Required target name for migration application`)
}

function redactError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(
    /postgres(?:ql)?:\/\/[^\s]+/gi,
    "[REDACTED_DATABASE_URL]",
  )
}

main().catch((error) => {
  console.error(`Database migration failed: ${redactError(error)}`)
  process.exitCode = 1
})
