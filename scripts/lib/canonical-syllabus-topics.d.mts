export interface CanonicalSyllabusTopic {
  active: boolean
  description: string
  id: string
  keywords: string[]
  moduleRef: string
  order: number
  title: string
  weekNumber: number
}

export const CANONICAL_SYLLABUS_TOPICS_FILE: string
export function loadCanonicalSyllabusTopics(
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
