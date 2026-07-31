#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { realpath } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import pg from "pg"

import {
  ContentImportConflictError,
  ContentImportValidationError,
  importApprovedContent,
  loadApprovedContentManifest,
} from "./lib/approved-content-import.mjs"
import {
  getMigrationStatus,
  loadMigrations,
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

  const manifestPath = path.resolve(repositoryRoot, options.manifest)
  await assertApprovedManifestPath(manifestPath)
  const validatedManifest = await loadApprovedContentManifest(manifestPath, {
    repositoryRoot,
  })
  assertGitTrackedReleaseFiles(
    manifestPath,
    validatedManifest.manifest.sourceFiles,
  )
  const databaseUrl = process.env.CONTENT_IMPORT_DATABASE_URL
  if (!databaseUrl) {
    throw new Error(
      "CONTENT_IMPORT_DATABASE_URL is required; DATABASE_URL is never used by the approved-content importer.",
    )
  }
  validatePostgresUrl(databaseUrl)

  const pool = new Pool({
    application_name: "ai-tutor-approved-content-import",
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 5_000,
    max: 1,
  })
  const client = await pool.connect()

  try {
    const migrations = await loadMigrations(
      path.resolve(repositoryRoot, "db/migrations"),
    )
    const migrationStatus = await getMigrationStatus(client, migrations)
    if (migrationStatus.state !== "current") {
      throw new Error(
        `Database migration status is ${migrationStatus.state}; approved content requires the complete checksum-clean migration history.`,
      )
    }

    const report = await importApprovedContent({
      actor: process.env.CONTENT_IMPORT_ACTOR,
      changeTicket: process.env.CONTENT_IMPORT_CHANGE_TICKET,
      client,
      confirmProduction: options.confirmProduction,
      sourceGitSha: process.env.CONTENT_IMPORT_SOURCE_GIT_SHA,
      dryRun: options.mode === "dry-run",
      target: options.target,
      validatedManifest,
    })
    printReport(report, options.json)
  } finally {
    client.release()
    await pool.end()
  }
}

function parseArguments(args) {
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true }
  }

  const options = {
    confirmProduction: false,
    json: false,
  }

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === "--apply") {
      setMode(options, "apply")
    } else if (argument === "--confirm-production") {
      options.confirmProduction = true
    } else if (argument === "--dry-run") {
      setMode(options, "dry-run")
    } else if (argument === "--json") {
      options.json = true
    } else if (argument === "--manifest") {
      options.manifest = requiredArgumentValue(args, ++index, argument)
    } else if (argument === "--target") {
      options.target = requiredArgumentValue(args, ++index, argument)
    } else {
      throw new Error(`Unknown approved-content import option: ${argument}.`)
    }
  }

  if (!options.manifest) {
    throw new Error("--manifest is required.")
  }
  if (!options.target) {
    throw new Error("--target is required.")
  }
  if (!options.mode) {
    throw new Error("Choose exactly one of --dry-run or --apply.")
  }
  return options
}

function setMode(options, mode) {
  if (options.mode && options.mode !== mode) {
    throw new Error("Choose exactly one of --dry-run or --apply.")
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

async function assertApprovedManifestPath(manifestPath) {
  const repositoryRealPath = await realpath(repositoryRoot)
  const manifestsRoot = await realpath(
    path.resolve(repositoryRoot, "data/production/manifests"),
  )
  const manifestRealPath = await realpath(manifestPath)
  const rootRelative = path.relative(repositoryRealPath, manifestsRoot)
  if (
    rootRelative === "" ||
    rootRelative.startsWith("..") ||
    path.isAbsolute(rootRelative)
  ) {
    throw new Error(
      "data/production/manifests/ must resolve inside the repository.",
    )
  }
  const relative = path.relative(manifestsRoot, manifestRealPath)
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    path.extname(manifestRealPath) !== ".json"
  ) {
    throw new Error(
      "Approved manifest must be a JSON file under data/production/manifests/.",
    )
  }
}

function assertGitTrackedReleaseFiles(manifestPath, sourceFiles) {
  const paths = [
    path.relative(repositoryRoot, manifestPath),
    ...sourceFiles.map((source) => source.path),
  ]

  for (const releasePath of paths) {
    const result = spawnSync(
      "git",
      ["ls-files", "--error-unmatch", "--", releasePath],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: "pipe",
      },
    )
    if (result.status !== 0) {
      throw new Error(
        `Approved release file must be tracked by Git: ${releasePath}.`,
      )
    }
  }
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

function printReport(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  console.log(
    `${report.mode === "dry-run" ? "Dry run" : "Import"}: ${report.status}`,
  )
  console.log(`Release: ${report.releaseId}`)
  console.log(`Manifest SHA-256: ${report.manifestHash}`)
  console.log(`Target: ${report.target}`)
  console.log(`Committed: ${report.committed ? "yes" : "no"}`)
  console.log("Summary:")
  for (const [kind, counts] of Object.entries(report.summary)) {
    console.log(
      `- ${kind}: ${counts.inserted} insert, ${counts.noOp} no-op, ${counts.total} total`,
    )
  }
  console.log("Validation:")
  for (const validation of report.validations) {
    console.log(`- ${validation.code}: ${validation.status}`)
  }
}

function printUsage() {
  console.log(`Usage:
  npm run db:import:approved -- --manifest <path> --target <test|staging|production> --dry-run
  npm run db:import:approved -- --manifest <path> --target <test|staging|production> --apply

Options:
  --apply               Apply the complete manifest in one transaction
  --confirm-production  Required for a Production apply
  --dry-run             Validate and compare without writing
  --json                Emit a machine-readable validation report
  --manifest            JSON manifest under data/production/manifests/
  --target              Required target name`)
}

function redactError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(
    /postgres(?:ql)?:\/\/[^\s]+/gi,
    "[REDACTED_DATABASE_URL]",
  )
}

main().catch((error) => {
  if (
    error instanceof ContentImportValidationError ||
    error instanceof ContentImportConflictError
  ) {
    if (process.argv.includes("--json")) {
      console.error(
        JSON.stringify(
          {
            issues: error.issues.map((entry) => ({
              code: entry.code,
              message: redactError(entry.message),
            })),
            report:
              error instanceof ContentImportConflictError
                ? error.report
                : undefined,
            status: "rejected",
          },
          null,
          2,
        ),
      )
      process.exitCode = 1
      return
    }
    console.error("Approved-content import rejected:")
    for (const entry of error.issues) {
      console.error(`- [${entry.code}] ${redactError(entry.message)}`)
    }
  } else {
    console.error(`Approved-content import failed: ${redactError(error)}`)
  }
  process.exitCode = 1
})
