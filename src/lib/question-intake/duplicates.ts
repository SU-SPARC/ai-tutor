import type {
  QuestionIntakeDuplicate,
  QuestionIntakeTopic,
} from "@/lib/question-intake/types";

export type QuestionIntakeDuplicateCandidate = {
  prompt: string;
  questionId: string;
  title: string;
  topicId: string;
};

export function questionIntakePromptFingerprint(prompt: string) {
  return prompt.trim().replace(/\s+/gu, " ").toLowerCase();
}

export function rankQuestionIntakeDuplicates(input: {
  candidates: QuestionIntakeDuplicateCandidate[];
  prompt: string;
  topicId: string;
}): QuestionIntakeDuplicate[] {
  const normalizedPrompt = questionIntakePromptFingerprint(input.prompt);
  const structure = questionStructureFingerprint(input.prompt);
  const promptTokens = significantTokens(input.prompt);

  return input.candidates
    .flatMap((candidate) => {
      const candidatePrompt = questionIntakePromptFingerprint(candidate.prompt);
      if (candidatePrompt === normalizedPrompt) {
        return [duplicate(candidate, "exact_text", 1)];
      }

      const sameTopic = candidate.topicId === input.topicId;
      if (
        sameTopic &&
        structure.length >= 24 &&
        questionStructureFingerprint(candidate.prompt) === structure
      ) {
        return [duplicate(candidate, "same_structure", 0.94)];
      }

      if (!sameTopic) return [];
      const similarity = jaccardSimilarity(
        promptTokens,
        significantTokens(candidate.prompt),
      );
      return similarity >= 0.72
        ? [duplicate(candidate, "similar_wording", similarity)]
        : [];
    })
    .sort(
      (left, right) =>
        right.similarity - left.similarity ||
        left.questionId.localeCompare(right.questionId),
    )
    .slice(0, 5);
}

export function questionIntakeTopicsFromRows(
  rows: Array<Record<string, unknown>>,
): QuestionIntakeTopic[] {
  return rows.flatMap((row) => {
    const id = text(row.id);
    const title = text(row.title);
    if (!id || !title) return [];
    return [
      {
        description: text(row.description) ?? "",
        id,
        title,
      },
    ];
  });
}

function duplicate(
  candidate: QuestionIntakeDuplicateCandidate,
  reason: QuestionIntakeDuplicate["reason"],
  similarity: number,
): QuestionIntakeDuplicate {
  return {
    questionId: candidate.questionId,
    reason,
    similarity: Number(similarity.toFixed(3)),
    title: candidate.title,
    topicId: candidate.topicId,
  };
}

function questionStructureFingerprint(prompt: string) {
  return questionIntakePromptFingerprint(prompt)
    .replace(/\\(?:dfrac|frac|tfrac)\{[^{}]+\}\{[^{}]+\}/gu, " <number> ")
    .replace(/[-+]?\d+(?:\.\d+)?%?/gu, "<number>")
    .replace(/\b[a-z]\b/gu, "<variable>")
    .replace(/\s+/gu, " ")
    .trim();
}

function significantTokens(value: string) {
  return new Set(
    questionIntakePromptFingerprint(value)
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(" ")
      .filter((token) => token.length >= 3),
  );
}

function jaccardSimilarity(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
