import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

import {
  CANONICAL_SYLLABUS_TOPICS_FILE,
  canonicalTopicMap,
} from "./canonical-syllabus-topics.mjs"

const PUBLIC_DATA_DIRECTORIES = [
  "data/demo",
  "data/processed",
  "data/production",
]

export async function inspectRepositoryTopicMappings(repositoryRoot, topics) {
  const known = canonicalTopicMap(topics)
  const staleMappings = []
  const syllabusChangesRequiringHumanReview = []
  const files = []

  for (const relativeDirectory of PUBLIC_DATA_DIRECTORIES) {
    await collectJsonFiles(path.join(repositoryRoot, relativeDirectory), files)
  }

  for (const filePath of files.sort()) {
    let payload
    try {
      payload = JSON.parse(await readFile(filePath, "utf8"))
    } catch (error) {
      staleMappings.push({
        file: relative(repositoryRoot, filePath),
        path: "$",
        reason: `Invalid JSON: ${error.message}`,
      })
      continue
    }
    walk(payload, "$", (value, jsonPath) => {
      if (Array.isArray(value)) {
        const topicIds = value
          .filter(
            (item) =>
              item &&
              typeof item === "object" &&
              typeof item.topicId === "string" &&
              known.has(item.topicId),
          )
          .map((item) => item.topicId)
        for (let index = 1; index < topicIds.length; index += 1) {
          if (
            known.get(topicIds[index - 1]).order >
            known.get(topicIds[index]).order
          ) {
            syllabusChangesRequiringHumanReview.push({
              file: relative(repositoryRoot, filePath),
              path: jsonPath,
              reason:
                "Topic-bearing items are not stored in canonical syllabus order; review and regenerate this export.",
            })
            break
          }
        }
      }
      if (
        (jsonPath.endsWith(".topicId") ||
          /\.topics\[\d+\]\.id$/.test(jsonPath)) &&
        typeof value === "string" &&
        !known.has(value)
      ) {
        staleMappings.push({
          file: relative(repositoryRoot, filePath),
          path: jsonPath,
          reason: `Unknown canonical topic ID ${value}`,
          topicId: value,
        })
      }
      if (jsonPath.endsWith(".expectedTopicOrder") && Array.isArray(value)) {
        const canonicalOrder = topics
          .filter((topic) => topic.active)
          .map((topic) => ({ id: topic.id, sortOrder: topic.order }))
        const exportedOrder = value.map((entry) =>
          typeof entry === "string"
            ? { id: entry, sortOrder: known.get(entry)?.order }
            : { id: entry?.id, sortOrder: entry?.sortOrder },
        )
        if (JSON.stringify(exportedOrder) !== JSON.stringify(canonicalOrder)) {
          syllabusChangesRequiringHumanReview.push({
            file: relative(repositoryRoot, filePath),
            path: jsonPath,
            reason:
              "Exported topic order differs from the current canonical syllabus; review and re-export explicitly.",
          })
        }
      }
    })
  }

  return { staleMappings, syllabusChangesRequiringHumanReview }
}

export async function inspectDatabaseTopics(client, topics) {
  const result = await client.query(`
    select id, title, description, sort_order, week_number, module_ref, is_active
    from topics
    order by sort_order, title, id
  `)
  const rows = result.rows
  const desired = canonicalTopicMap(topics)
  const existing = new Map(rows.map((row) => [String(row.id), row]))
  const missingTopics = topics.filter((topic) => !existing.has(topic.id))
  const changedTopics = topics.filter((topic) => {
    const row = existing.get(topic.id)
    return row && !topicMatchesRow(topic, row)
  })
  const extraTopics = rows.filter((row) => !desired.has(String(row.id)))
  const duplicateSlugs = duplicates(rows, (row) => slug(row.id))
  const duplicateOrderValues = duplicates(rows, (row) => Number(row.sort_order))
  const desiredOrders = new Map(topics.map((topic) => [topic.order, topic.id]))
  const blockingOrderConflicts = extraTopics.filter((row) =>
    desiredOrders.has(Number(row.sort_order)),
  )
  const staleTopicMappings = []

  const tablesResult = await client.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
  `)
  const tables = new Set(tablesResult.rows.map((row) => String(row.table_name)))
  for (const [table, column] of [
    ["questions", "topic_id"],
    ["question_patterns", "topic_id"],
    ["retrieval_chunks", "topic_id"],
  ]) {
    if (!tables.has(table)) continue
    const refs = await client.query(
      `select ${column} as topic_id, count(*)::int as reference_count from ${table} where ${column} is not null group by ${column}`,
    )
    for (const row of refs.rows) {
      if (!desired.has(String(row.topic_id))) {
        staleTopicMappings.push({
          location: `${table}.${column}`,
          referenceCount: Number(row.reference_count),
          topicId: String(row.topic_id),
        })
      }
    }
  }
  if (tables.has("question_versions")) {
    const refs = await client.query(`
      select snapshot_json ->> 'topicId' as topic_id, count(*)::int as reference_count
      from question_versions
      where snapshot_json ->> 'topicId' is not null
      group by snapshot_json ->> 'topicId'
    `)
    for (const row of refs.rows) {
      if (!desired.has(String(row.topic_id))) {
        staleTopicMappings.push({
          location: "question_versions.snapshot_json.topicId",
          referenceCount: Number(row.reference_count),
          topicId: String(row.topic_id),
        })
      }
    }
  }

  return {
    blockingOrderConflicts,
    changedTopics,
    duplicateOrderValues,
    duplicateSlugs,
    extraTopics,
    missingTopics,
    staleTopicMappings,
  }
}

export async function synchronizeDatabaseTopics(client, topics, inspection) {
  if (
    inspection.blockingOrderConflicts.length > 0 ||
    inspection.duplicateOrderValues.length > 0 ||
    inspection.duplicateSlugs.length > 0
  ) {
    throw new Error(
      "Topic synchronization is blocked by duplicate identity/order data requiring human review.",
    )
  }

  await client.query("begin")
  try {
    const maxOrderResult = await client.query(
      "select coalesce(max(sort_order), 0)::int as max_order from topics",
    )
    const temporaryBase = Number(maxOrderResult.rows[0]?.max_order ?? 0) + 1000
    for (const [index, topic] of inspection.changedTopics.entries()) {
      await client.query("update topics set sort_order = $1 where id = $2", [
        temporaryBase + index,
        topic.id,
      ])
    }
    for (const topic of topics) {
      await client.query(
        `
          insert into topics
            (id, title, description, sort_order, week_number, module_ref, is_active)
          values ($1, $2, $3, $4, $5, $6, $7)
          on conflict (id) do update set
            title = excluded.title,
            description = excluded.description,
            sort_order = excluded.sort_order,
            week_number = excluded.week_number,
            module_ref = excluded.module_ref,
            is_active = excluded.is_active,
            updated_at = now()
        `,
        [
          topic.id,
          topic.title,
          topic.description,
          topic.order,
          topic.weekNumber,
          topic.moduleRef,
          topic.active,
        ],
      )
    }
    await client.query("commit")
  } catch (error) {
    await client.query("rollback")
    throw error
  }
}

export function buildSyllabusSyncReport({
  database,
  mode,
  repository,
  topics,
}) {
  const humanReview = [...repository.syllabusChangesRequiringHumanReview]
  if (database) {
    humanReview.push(
      ...database.extraTopics.map((row) => ({
        reason:
          "Database topic is not canonical and was retained; decide whether and how to remap it.",
        topicId: String(row.id),
      })),
      ...database.staleTopicMappings.map((mapping) => ({
        ...mapping,
        reason:
          "Stored content references a non-canonical topic; remap it explicitly.",
      })),
      ...database.blockingOrderConflicts.map((row) => ({
        reason: `Non-canonical topic occupies canonical order ${row.sort_order}; resolve it manually.`,
        topicId: String(row.id),
      })),
    )
  }
  return {
    canonicalSource: CANONICAL_SYLLABUS_TOPICS_FILE,
    canonicalTopicCount: topics.length,
    database: database
      ? {
          changed: database.changedTopics.map(({ id }) => id),
          duplicateOrderValues: database.duplicateOrderValues,
          duplicateSlugs: database.duplicateSlugs,
          extra: database.extraTopics.map((row) => String(row.id)),
          missing: database.missingTopics.map(({ id }) => id),
          staleMappings: database.staleTopicMappings,
        }
      : null,
    mode,
    repository,
    syllabusChangesRequiringHumanReview: humanReview,
  }
}

function topicMatchesRow(topic, row) {
  return (
    topic.title === row.title &&
    topic.description === row.description &&
    topic.order === Number(row.sort_order) &&
    topic.weekNumber === Number(row.week_number) &&
    topic.moduleRef === row.module_ref &&
    topic.active === Boolean(row.is_active)
  )
}

function duplicates(rows, selector) {
  const groups = new Map()
  for (const row of rows) {
    const key = selector(row)
    groups.set(key, [...(groups.get(key) ?? []), String(row.id)])
  }
  return [...groups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([value, ids]) => ({ ids, value }))
}

async function collectJsonFiles(directory, files) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === "ENOENT") return
    throw error
  }
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) await collectJsonFiles(filePath, files)
    else if (entry.isFile() && entry.name.endsWith(".json"))
      files.push(filePath)
  }
}

function walk(value, jsonPath, visit) {
  visit(value, jsonPath)
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${jsonPath}[${index}]`, visit))
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) =>
      walk(item, `${jsonPath}.${key}`, visit),
    )
  }
}

function relative(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join("/")
}

function slug(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}
