export interface CanonicalSyllabusTopic {
  active: boolean
  /** Set by the loaders; absent in the JSON files. */
  courseId?: string
  description: string
  id: string
  keywords: string[]
  moduleRef: string
  order: number
  title: string
  weekNumber: number
}

export const CANONICAL_SYLLABUS_TOPICS_FILE: string
export const DEFAULT_COURSE_ID: string
export const CANONICAL_COURSE_IDS: readonly string[]
export function canonicalSyllabusTopicsFile(courseId?: string): string
export function loadCanonicalSyllabusTopics(
  repositoryRoot: string,
  courseId?: string,
): Promise<CanonicalSyllabusTopic[]>
export function loadAllCanonicalSyllabusTopics(
  repositoryRoot: string,
): Promise<CanonicalSyllabusTopic[]>
export function validateCanonicalSyllabusTopics(topics: unknown): string[]
export function canonicalTopicMap(
  topics: CanonicalSyllabusTopic[],
): Map<string, CanonicalSyllabusTopic>
export function compareTopics(
  left: { id?: string; title?: string; topicId?: string; topicTitle?: string },
  right: { id?: string; title?: string; topicId?: string; topicTitle?: string },
  topics: CanonicalSyllabusTopic[],
): number
