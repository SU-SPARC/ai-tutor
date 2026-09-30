import type { CanonicalSyllabusTopic } from "./canonical-syllabus-topics.mjs"

export interface DatabaseTopicInspection {
  blockingOrderConflicts: Array<Record<string, unknown>>
  changedTopics: CanonicalSyllabusTopic[]
  courseConflicts: Array<{ ownedByCourse: string; topicId: string }>
  duplicateOrderValues: Array<{ ids: string[]; value: number }>
  duplicateSlugs: Array<{ ids: string[]; value: string }>
  extraTopics: Array<{ id: string; [key: string]: unknown }>
  missingTopics: CanonicalSyllabusTopic[]
  staleTopicMappings: Array<Record<string, unknown>>
}

export function inspectRepositoryTopicMappings(
  repositoryRoot: string,
  topics: CanonicalSyllabusTopic[],
  allTopics?: CanonicalSyllabusTopic[],
  courseId?: string,
): Promise<{
  staleMappings: Array<Record<string, unknown>>
  syllabusChangesRequiringHumanReview: Array<Record<string, unknown>>
}>
export function inspectDatabaseTopics(
  client: unknown,
  topics: CanonicalSyllabusTopic[],
  courseId?: string,
): Promise<DatabaseTopicInspection>
export function synchronizeDatabaseTopics(
  client: unknown,
  topics: CanonicalSyllabusTopic[],
  inspection: DatabaseTopicInspection,
  courseId?: string,
): Promise<void>
export function buildSyllabusSyncReport(
  input: Record<string, unknown>,
): Record<string, unknown>
