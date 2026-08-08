import type { QuestionContent } from "@/lib/types";

export type ComparableQuestionContent = Pick<
  QuestionContent,
  | "answer"
  | "difficulty"
  | "hints"
  | "misconceptions"
  | "prompt"
  | "solutionSteps"
  | "title"
  | "topicId"
>;

const COMPARABLE_FIELDS = [
  ["Title", "title"],
  ["Wording", "prompt"],
  ["Topic mapping", "topicId"],
  ["Difficulty", "difficulty"],
  ["Final answer", "answer"],
  ["Hints", "hints"],
  ["Solution steps", "solutionSteps"],
  ["Misconception notes", "misconceptions"],
] as const;

export function changedQuestionVersionFields(
  base: ComparableQuestionContent,
  candidate: ComparableQuestionContent,
) {
  return COMPARABLE_FIELDS.flatMap(([label, field]) =>
    JSON.stringify(base[field]) === JSON.stringify(candidate[field])
      ? []
      : [label],
  );
}
