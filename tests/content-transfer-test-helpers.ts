import type {
  ContentTransferDocument,
  ContentTransferQuestion,
} from "@/lib/content-transfer/types";
import { activeCanonicalSyllabusTopics } from "@/lib/data/canonical-syllabus-topics";

export function validDocument(
  overrides: Partial<ContentTransferDocument> = {},
): ContentTransferDocument {
  const topic = activeCanonicalSyllabusTopics[0];
  return {
    format: "professor_question_content",
    questions: [validQuestion()],
    schemaVersion: 1,
    topics: [{ id: topic.id, order: topic.order, title: topic.title }],
    ...overrides,
  };
}

export function validQuestion(
  overrides: Partial<ContentTransferQuestion> = {},
): ContentTransferQuestion {
  const topic = activeCanonicalSyllabusTopics[0];
  return {
    answer: {
      acceptedAnswers: ["0.5", "1/2"],
      explanation: "Divide one favorable outcome by two possible outcomes.",
      numericValue: 0.5,
      tolerance: 0.001,
    },
    difficulty: "foundational",
    hints: ["Count favorable outcomes first."],
    misconceptions: [
      {
        feedback: "Use favorable outcomes divided by total outcomes.",
        id: "reversed-ratio",
        matchTerms: ["2"],
      },
    ],
    prompt:
      "One of two equally likely outcomes is favorable. What is the probability?",
    reviewState: "draft",
    solutionSteps: ["Compute 1 / 2 = 0.5."],
    stableId: "transfer-question-one",
    title: "One favorable outcome",
    topicId: topic.id,
    ...overrides,
  };
}
