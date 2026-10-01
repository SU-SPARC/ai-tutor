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
> &
  Partial<Pick<QuestionContent, "figure">>;

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
  const changed: string[] = COMPARABLE_FIELDS.flatMap(([label, field]) =>
    JSON.stringify(base[field]) === JSON.stringify(candidate[field])
      ? []
      : [label],
  );
  const figureChange = questionFigureChange(base.figure, candidate.figure);
  if (figureChange) changed.push(figureChange);
  return changed;
}

/** "Figure added" / "Figure removed" / "Figure changed", or undefined. */
export function questionFigureChange(
  base: QuestionContent["figure"] | null,
  candidate: QuestionContent["figure"] | null,
) {
  const hasBase = base !== undefined && base !== null;
  const hasCandidate = candidate !== undefined && candidate !== null;
  if (!hasBase && !hasCandidate) return undefined;
  if (!hasBase) return "Figure added";
  if (!hasCandidate) return "Figure removed";
  return stableJson(base) === stableJson(candidate)
    ? undefined
    : "Figure changed";
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
