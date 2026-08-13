#!/usr/bin/env node

import path from "node:path"
import { fileURLToPath } from "node:url"

import { loadCanonicalSyllabusTopics } from "./lib/canonical-syllabus-topics.mjs"
import {
  buildSyllabusSyncReport,
  inspectDatabaseTopics,
  inspectRepositoryTopicMappings,
  synchronizeDatabaseTopics,
} from "./lib/syllabus-topic-sync.mjs"

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const mode = args.apply ? "apply" : "dry-run"
  const topics = await loadCanonicalSyllabusTopics(repositoryRoot)
  const repository = await inspectRepositoryTopicMappings(
    repositoryRoot,
    topics,
  )
  let client
  let database

  if (!args.filesOnly) {
    const connectionString =
      process.env.DATABASE_URL ?? process.env.POSTGRES_URL
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL or POSTGRES_URL is required unless --files-only is used.",
      )
    }
    const { Client } = await import("pg")
    client = new Client({ connectionString })
    await client.connect()
    try {
      database = await inspectDatabaseTopics(client, topics)
      if (args.apply) {
        await synchronizeDatabaseTopics(client, topics, database)
        database = await inspectDatabaseTopics(client, topics)
      }
    } finally {
      await client.end()
    }
  }

  const report = buildSyllabusSyncReport({
    database,
    mode,
    repository,
    topics,
  })
  console.log(JSON.stringify(report, null, 2))
  if (args.apply)
    console.log(
      "Canonical topic rows synchronized; no content or extra topics were deleted.",
    )

  const failures =
    repository.staleMappings.length +
    (database?.duplicateOrderValues.length ?? 0) +
    (database?.duplicateSlugs.length ?? 0) +
    (database?.blockingOrderConflicts.length ?? 0)
  if (failures > 0) process.exitCode = 1
}

function parseArgs(rawArgs) {
  const args = { apply: false, filesOnly: false }
  let requestedMode
  for (const arg of rawArgs) {
    if (arg === "--apply" || arg === "--dry-run") {
      if (requestedMode && requestedMode !== arg) {
        throw new Error("Choose either --dry-run or --apply, not both.")
      }
      requestedMode = arg
      args.apply = arg === "--apply"
    } else if (arg === "--files-only") args.filesOnly = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (args.apply && args.filesOnly) {
    throw new Error("--apply cannot be combined with --files-only.")
  }
  return args
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
