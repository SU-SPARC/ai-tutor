import calculusTopicData from "../../../data/canonical/calculus-1/syllabus-topics.json"
import probabilityStatisticsTopicData from "../../../data/canonical/probability-statistics/syllabus-topics.json"
import {
  CALCULUS_COURSE_ID,
  PROBABILITY_STATISTICS_COURSE_ID,
} from "@/lib/course-catalog"
import type { Topic } from "@/lib/types"

type CanonicalTopicRecord = Omit<Topic, "courseId">

function validateAndSortTopics(courseId: string, topics: Topic[]) {
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
      throw new Error(
        `Duplicate syllabus topic id or order for ${topic.id} in course ${courseId}.`,
      )
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

// One canonical syllabus per course, in course display order. A course whose
// syllabus has not been provided has an empty file and so no topics.
const COURSE_SYLLABI: ReadonlyArray<{
  courseId: string
  topics: CanonicalTopicRecord[]
}> = [
  {
    courseId: PROBABILITY_STATISTICS_COURSE_ID,
    topics: probabilityStatisticsTopicData as CanonicalTopicRecord[],
  },
  {
    courseId: CALCULUS_COURSE_ID,
    topics: calculusTopicData as unknown as CanonicalTopicRecord[],
  },
]

const topicsByCourse = new Map<string, Topic[]>(
  COURSE_SYLLABI.map(({ courseId, topics }) => [
    courseId,
    validateAndSortTopics(
      courseId,
      topics.map((topic) => ({ ...topic, courseId })),
    ),
  ]),
)

const courseRanks = new Map(
  COURSE_SYLLABI.map(({ courseId }, index) => [courseId, index]),
)

// Topic ids are global, so one id may not appear in two courses.
const seenTopicIds = new Set<string>()
for (const topics of topicsByCourse.values()) {
  for (const topic of topics) {
    if (seenTopicIds.has(topic.id)) {
      throw new Error(`Syllabus topic id ${topic.id} is used by two courses.`)
    }
    seenTopicIds.add(topic.id)
  }
}

/** Every course's canonical topics, in course order then syllabus order. */
export const canonicalSyllabusTopics: Topic[] = COURSE_SYLLABI.flatMap(
  ({ courseId }) => topicsByCourse.get(courseId) ?? [],
)
export const activeCanonicalSyllabusTopics = canonicalSyllabusTopics.filter(
  (topic) => topic.active,
)

export function canonicalSyllabusTopicsForCourse(courseId: string) {
  return topicsByCourse.get(courseId) ?? []
}

export function activeCanonicalSyllabusTopicsForCourse(courseId: string) {
  return canonicalSyllabusTopicsForCourse(courseId).filter(
    (topic) => topic.active,
  )
}

const topicOrders = new Map(
  canonicalSyllabusTopics.map((topic) => [
    topic.id,
    (courseRanks.get(topic.courseId) ?? 0) * 1_000_000 + topic.order,
  ]),
)

/** Course order first, then syllabus order within the course. */
export function compareCanonicalTopicIds(leftId: string, rightId: string) {
  return (
    (topicOrders.get(leftId) ?? Number.MAX_SAFE_INTEGER) -
      (topicOrders.get(rightId) ?? Number.MAX_SAFE_INTEGER) ||
    leftId.localeCompare(rightId)
  )
}
