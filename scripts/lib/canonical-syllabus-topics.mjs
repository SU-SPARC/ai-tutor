import { readFile } from "node:fs/promises"
import path from "node:path"

// Courses registered by migration 028, in display order. Each has one
// canonical syllabus file at data/canonical/<course id>/syllabus-topics.json.
export const DEFAULT_COURSE_ID = "probability-statistics"
export const CANONICAL_COURSE_IDS = Object.freeze([
  "probability-statistics",
  "calculus-1",
])

/** The default course's canonical file, kept for importers written for one course. */
export const CANONICAL_SYLLABUS_TOPICS_FILE =
  "data/canonical/probability-statistics/syllabus-topics.json"

export function canonicalSyllabusTopicsFile(courseId = DEFAULT_COURSE_ID) {
  if (!CANONICAL_COURSE_IDS.includes(courseId)) {
    throw new Error(
      `Unknown course "${courseId}". Known courses: ${CANONICAL_COURSE_IDS.join(", ")}.`,
    )
  }
  return `data/canonical/${courseId}/syllabus-topics.json`
}

/**
 * Loads one course's canonical topics, each stamped with its `courseId`. A
 * course whose syllabus has not been provided yet has an empty file, which is
 * valid and yields no topics.
 */
export async function loadCanonicalSyllabusTopics(
  repositoryRoot,
  courseId = DEFAULT_COURSE_ID,
) {
  const inputPath = path.join(
    repositoryRoot,
    canonicalSyllabusTopicsFile(courseId),
  )
  const topics = JSON.parse(await readFile(inputPath, "utf8"))
  const errors = validateCanonicalSyllabusTopics(topics)

  if (errors.length > 0) {
    throw new Error(
      `Invalid canonical syllabus topics for ${courseId}:\n${errors.map((error) => `- ${error}`).join("\n")}`,
    )
  }

  return topics.map((topic) => ({ ...topic, courseId }))
}

/** Every course's canonical topics, for checks that must recognise any course. */
export async function loadAllCanonicalSyllabusTopics(repositoryRoot) {
  const perCourse = await Promise.all(
    CANONICAL_COURSE_IDS.map((courseId) =>
      loadCanonicalSyllabusTopics(repositoryRoot, courseId),
    ),
  )
  return perCourse.flat()
}

export function validateCanonicalSyllabusTopics(topics) {
  const errors = []
  if (!Array.isArray(topics)) {
    return ["The canonical topic catalog must be an array."]
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
