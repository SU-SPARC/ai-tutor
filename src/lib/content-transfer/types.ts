import type {
  Difficulty,
  Misconception,
  QuestionVersionState,
} from "@/lib/types";

export const CONTENT_TRANSFER_FORMAT = "professor_question_content" as const;
export const CONTENT_TRANSFER_SCHEMA_VERSION = 1 as const;
export const CONTENT_TRANSFER_IMPORT_STATES = [
  "draft",
  "needs_review",
  "revision_requested",
  "approved",
  "rejected",
] as const;

export type ContentTransferImportState =
  (typeof CONTENT_TRANSFER_IMPORT_STATES)[number];
export type ContentTransferExportScope = "all" | "approved" | "drafts";

export type ContentTransferTopicMapping = {
  id: string;
  order: number;
  title: string;
};

export type ContentTransferQuestion = {
  answer: {
    acceptedAnswers: string[];
    explanation: string;
    numericValue?: number;
    tolerance?: number;
  };
  difficulty: Difficulty;
  hints: string[];
  misconceptions: Misconception[];
  prompt: string;
  reviewState: ContentTransferImportState;
  solutionSteps: string[];
  stableId: string;
  title: string;
  topicId: string;
};

export type ContentTransferDocument = {
  exportedAt?: string;
  format: typeof CONTENT_TRANSFER_FORMAT;
  questions: ContentTransferQuestion[];
  schemaVersion: typeof CONTENT_TRANSFER_SCHEMA_VERSION;
  topics: ContentTransferTopicMapping[];
};

export type ContentTransferPreviewRow = {
  errors: string[];
  index: number;
  reviewState?: ContentTransferImportState;
  stableId?: string;
  status: "duplicate" | "invalid" | "ready";
  title?: string;
  topicId?: string;
  warnings: string[];
};

export type ContentTransferPreview = {
  canApply: boolean;
  format: typeof CONTENT_TRANSFER_FORMAT;
  rootErrors: string[];
  rows: ContentTransferPreviewRow[];
  schemaVersion: typeof CONTENT_TRANSFER_SCHEMA_VERSION;
  storageChecked: boolean;
  summary: {
    duplicates: number;
    invalid: number;
    ready: number;
    total: number;
  };
};

export type ContentTransferImportResult = {
  auditEventId: number;
  importedIds: string[];
  importedStates: Partial<Record<ContentTransferImportState, number>>;
  requestId: string;
};

export type ContentTransferStorageInspection = {
  existingContentFingerprints: string[];
  existingMisconceptionIds: string[];
  existingQuestionIds: string[];
  unavailableTopicIds: string[];
};

export function isContentTransferImportState(
  value: string,
): value is ContentTransferImportState {
  return (CONTENT_TRANSFER_IMPORT_STATES as readonly string[]).includes(value);
}

export function isContentTransferDraftState(state: QuestionVersionState) {
  return (
    state === "draft" ||
    state === "needs_review" ||
    state === "revision_requested"
  );
}
