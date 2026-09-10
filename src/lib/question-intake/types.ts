import type { AnswerSpec } from "@/lib/tutor/answer/spec";
import type {
  Difficulty,
  Misconception,
  QuestionLifecycleDto,
} from "@/lib/types";

export const QUESTION_INTAKE_QUESTION_TYPES = ["free_response"] as const;
export const QUESTION_INTAKE_ANSWER_TYPES = ["numeric", "text"] as const;
export const QUESTION_INTAKE_SOURCE_KINDS = [
  "professor_authored",
  "professor_provided_course_material",
  "licensed_approved_course_material",
  "unknown_needs_review",
] as const;

export type QuestionIntakeQuestionType =
  (typeof QUESTION_INTAKE_QUESTION_TYPES)[number];
export type QuestionIntakeAnswerType =
  (typeof QUESTION_INTAKE_ANSWER_TYPES)[number];
export type QuestionIntakeSourceKind =
  (typeof QUESTION_INTAKE_SOURCE_KINDS)[number];
export type QuestionIntakeInputMode = "image" | "text";

export type QuestionIntakeTopic = {
  description: string;
  id: string;
  title: string;
};

export type QuestionIntakeConfidence = {
  checker?: number;
  answer: number;
  extraction: number;
  overall: number;
  topic: number;
};

export type QuestionIntakeModelDraft = {
  answer: {
    spec?: AnswerSpec;
    acceptedAnswers: string[];
    explanation: string;
    numericValue?: number;
    tolerance?: number;
  };
  answerType: QuestionIntakeAnswerType;
  confidence: QuestionIntakeConfidence;
  difficulty: Difficulty;
  hints: string[];
  misconceptions: Misconception[];
  prompt: string;
  questionType: QuestionIntakeQuestionType;
  schemaVersion: 1;
  solutionSteps: string[];
  title: string;
  topicId: string;
  unreadableSegments: string[];
  warnings: string[];
};

export type QuestionIntakeVerificationCheck = {
  code:
    | "answer_checker_config"
    | "answer_schema"
    | "answer_solution_consistency"
    | "hint_progression"
    | "topic_assignment";
  message: string;
  status: "failed" | "passed" | "warning";
};

export type QuestionIntakeDraft = QuestionIntakeModelDraft & {
  review: {
    checks: QuestionIntakeVerificationCheck[];
    required: boolean;
    status: "needs_professor_review";
  };
};

export type QuestionIntakeDuplicate = {
  questionId: string;
  reason: "exact_text" | "same_structure" | "similar_wording";
  similarity: number;
  title: string;
  topicId: string;
};

export type QuestionIntakeAnalysisResult = {
  draft: QuestionIntakeDraft;
  duplicates: QuestionIntakeDuplicate[];
  inputMode: QuestionIntakeInputMode;
  model: string;
  saved: false;
};

export type QuestionIntakeSaveResult = {
  duplicates: QuestionIntakeDuplicate[];
  question: QuestionLifecycleDto;
};
