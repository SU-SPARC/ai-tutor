import { readFile } from "node:fs/promises"
import path from "node:path"

export const CANONICAL_SYLLABUS_TOPICS_FILE =
  "data/canonical/syllabus-topics.json"

export async function loadCanonicalSyllabusTopics(repositoryRoot) {
  const inputPath = path.join(repositoryRoot, CANONICAL_SYLLABUS_TOPICS_FILE)
  const topics = JSON.parse(await readFile(inputPath, "utf8"))
  const errors = validateCanonicalSyllabusTopics(topics)

  if (errors.length > 0) {
    throw new Error(
      `Invalid canonical syllabus topics:\n${errors.map((error) => `- ${error}`).join("\n")}`,
    )
  }

  return topics.map((topic) => ({ ...topic }))
}

export function validateCanonicalSyllabusTopics(topics) {
  const errors = []
  if (!Array.isArray(topics) || topics.length === 0) {
    return ["The canonical topic catalog must be a non-empty array."]
  }

  const ids = new Set()
  const slugs = new Map()
  const orders = new Map()
  let previousOrder = 0

  topics.forEach((topic, index) => {
    const label = `topics[${index}]`
    for (const field of ["id", "title", "description", "moduleRef"]) {
      if (typeof topic?.[field] !== "string" || topic[field].trim() === "") {
        errors.push(`${label}.${field} must be a non-empty string.`)
      }
    }
    if (
      !Array.isArray(topic?.keywords) ||
      topic.keywords.length === 0 ||
      topic.keywords.some(
        (keyword) => typeof keyword !== "string" || keyword.trim() === "",
      )
    ) {
      errors.push(`${label}.keywords must be a non-empty string array.`)
    }

    const normalizedSlug = slug(topic?.id)
    if (topic?.id !== normalizedSlug) {
      errors.push(`${label}.id must be its normalized lowercase slug.`)
    }
    if (ids.has(topic?.id)) errors.push(`${label}.id duplicates ${topic.id}.`)
    if (slugs.has(normalizedSlug)) {
      errors.push(
        `${label}.id has duplicate normalized slug ${normalizedSlug}.`,
      )
    }
    ids.add(topic?.id)
    slugs.set(normalizedSlug, topic?.id)

    if (!Number.isInteger(topic?.order) || topic.order < 1) {
      errors.push(`${label}.order must be a positive integer.`)
    } else {
      if (orders.has(topic.order)) {
        errors.push(`${label}.order duplicates order ${topic.order}.`)
      }
      if (topic.order <= previousOrder) {
        errors.push(
          "Topics must be stored in strictly increasing syllabus order.",
        )
      }
      orders.set(topic.order, topic.id)
      previousOrder = topic.order
    }

    if (!Number.isInteger(topic?.weekNumber) || topic.weekNumber < 1) {
      errors.push(`${label}.weekNumber must be a positive integer.`)
    }
    if (typeof topic?.active !== "boolean") {
      errors.push(`${label}.active must be a boolean.`)
    }
  })

  return [...new Set(errors)]
}

export function canonicalTopicMap(topics) {
  return new Map(topics.map((topic) => [topic.id, topic]))
}

export function compareTopics(left, right, topics) {
  const order = new Map(topics.map((topic) => [topic.id, topic.order]))
  return (
    (order.get(left.topicId ?? left.id) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.topicId ?? right.id) ?? Number.MAX_SAFE_INTEGER) ||
    String(left.topicTitle ?? left.title ?? "").localeCompare(
      String(right.topicTitle ?? right.title ?? ""),
    ) ||
    String(left.topicId ?? left.id).localeCompare(
      String(right.topicId ?? right.id),
    )
  )
}

function slug(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}
