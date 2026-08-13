import type { CanonicalSyllabusTopic } from "./canonical-syllabus-topics.mjs"

export interface DatabaseTopicInspection {
  blockingOrderConflicts: Array<Record<string, unknown>>
  changedTopics: CanonicalSyllabusTopic[]
  duplicateOrderValues: Array<{ ids: string[]; value: number }>
  duplicateSlugs: Array<{ ids: string[]; value: string }>
  extraTopics: Array<{ id: string; [key: string]: unknown }>
  missingTopics: CanonicalSyllabusTopic[]
  staleTopicMappings: Array<Record<string, unknown>>
}

export function inspectRepositoryTopicMappings(
  repositoryRoot: string,
  topics: CanonicalSyllabusTopic[],
): Promise<{
  staleMappings: Array<Record<string, unknown>>
  syllabusChangesRequiringHumanReview: Array<Record<string, unknown>>
}>
export function inspectDatabaseTopics(
  client: unknown,
  topics: CanonicalSyllabusTopic[],
): Promise<DatabaseTopicInspection>
export function synchronizeDatabaseTopics(
  client: unknown,
  topics: CanonicalSyllabusTopic[],
  inspection: DatabaseTopicInspection,
): Promise<void>
export function buildSyllabusSyncReport(
  input: Record<string, unknown>,
): Record<string, unknown>
