export interface ContentImportIssue {
  code: string
  message: string
}

export interface ContentImportClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>
}

export interface ApprovedTopic {
  id: string
  title: string
  description: string
  sortOrder: number
  weekNumber: number
  moduleRef: string
  isActive: boolean
}

export interface ApprovedPattern {
  id: string
  topicId: string
  title: string
  description: string
  difficulty: string
  conceptTags: string[]
  misconceptionTags: string[]
}

export interface ApprovedOrderedBody {
  order: number
  body: string
}

export interface ApprovedMisconception {
  id: string
  feedback: string
  matchTerms: string[]
  metadata: { conceptTags: string[] }
}

export interface ApprovedQuestion {
  id: string
  topicId: string
  patternId: string | null
  origin: string
  title: string
  prompt: string
  difficulty: string
  acceptedAnswers: string[]
  numericValue: number | null
  tolerance: number | null
  answerExplanation: string
  originalityNote: string
  hints: ApprovedOrderedBody[]
  solutionSteps: ApprovedOrderedBody[]
  misconceptions: ApprovedMisconception[]
}

export interface ApprovedContentManifest {
  schemaVersion: number
  releaseId: string
  sourceGitSha: string
  sourceFiles: Array<{ path: string; sha256: string }>
  approval: {
    status: string
    signedByUserId: string
    signedAt: string
    changeTicket: string
    contentSha256: string
  }
  expectedTopicOrder: Array<{ id: string; sortOrder: number }>
  approvedGeneratedQuestionIds: string[]
  expectedCounts: {
    topics: number
    patterns: number
    questions: number
    hints: number
    solutionSteps: number
    misconceptions: number
  }
  contentHashes: Record<string, Record<string, string>>
  topics: ApprovedTopic[]
  patterns: ApprovedPattern[]
  questions: ApprovedQuestion[]
}

export interface ValidatedApprovedContentManifest {
  contentHashes: Record<string, Record<string, string>>
  manifest: ApprovedContentManifest
  manifestHash: string
  sourceFilesVerified: boolean
}

export interface ContentImportReport {
  committed: boolean
  manifestHash: string
  mode: "apply" | "dry-run" | "plan"
  operationalCounts: Record<string, number>
  releaseId: string
  signerUserId: string
  status: "applied" | "no-op" | "ready" | "rejected" | "valid"
  summary: Record<string, { inserted: number; noOp: number; total: number }>
  target: string
  validations: Array<{ code: string; status: "failed" | "passed" }>
}

export const CONTENT_IMPORT_ADVISORY_LOCK_ID: number

export function canonicalJson(value: unknown): string
export function sha256(value: string | Uint8Array): string
export function computeContentHashes(
  manifest: ApprovedContentManifest,
): Record<string, Record<string, string>>
export function computeManifestApprovalHash(
  manifest: ApprovedContentManifest,
): string
export function validateApprovedContentManifest(
  raw: unknown,
  options?: { now?: Date },
): ValidatedApprovedContentManifest
export function loadApprovedContentManifest(
  manifestPath: string,
  options: { now?: Date; repositoryRoot: string },
): Promise<ValidatedApprovedContentManifest>
export function importApprovedContent(options: {
  actor?: string
  changeTicket?: string
  client: ContentImportClient
  confirmProduction?: boolean
  sourceGitSha?: string
  dryRun?: boolean
  lockTimeoutMs?: number
  statementTimeoutMs?: number
  target?: string
  validatedManifest: ValidatedApprovedContentManifest
}): Promise<ContentImportReport>

export class ContentImportValidationError extends Error {
  issues: ContentImportIssue[]
}

export class ContentImportConflictError extends Error {
  issues: ContentImportIssue[]
  report: ContentImportReport
}
