import topicData from "../../../data/canonical/syllabus-topics.json"
import type { Topic } from "@/lib/types"

function validateAndSortTopics(topics: Topic[]) {
  const ids = new Set<string>()
  const orders = new Set<number>()

  for (const topic of topics) {
    if (!topic.id || !topic.title || !topic.moduleRef) {
      throw new Error(
        "Every syllabus topic needs an id, title, and module reference.",
      )
    }
    if (
      !Number.isInteger(topic.order) ||
      topic.order < 1 ||
      !Number.isInteger(topic.weekNumber) ||
      topic.weekNumber < 1
    ) {
      throw new Error(`Invalid syllabus order metadata for topic ${topic.id}.`)
    }
    if (ids.has(topic.id) || orders.has(topic.order)) {
      throw new Error(`Duplicate syllabus topic id or order for ${topic.id}.`)
    }
    ids.add(topic.id)
    orders.add(topic.order)
  }

  return [...topics].sort(
    (left, right) =>
      left.order - right.order ||
      left.title.localeCompare(right.title) ||
      left.id.localeCompare(right.id),
  )
}

export const canonicalSyllabusTopics = validateAndSortTopics(
  topicData as Topic[],
)
export const activeCanonicalSyllabusTopics = canonicalSyllabusTopics.filter(
  (topic) => topic.active,
)

const topicOrders = new Map(
  canonicalSyllabusTopics.map((topic) => [topic.id, topic.order]),
)

export function compareCanonicalTopicIds(leftId: string, rightId: string) {
  return (
    (topicOrders.get(leftId) ?? Number.MAX_SAFE_INTEGER) -
      (topicOrders.get(rightId) ?? Number.MAX_SAFE_INTEGER) ||
    leftId.localeCompare(rightId)
  )
}
