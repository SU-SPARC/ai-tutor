/**
 * Professor-facing destinations for one question. Kept in one place so the
 * intake screen, the lifecycle table, and the detail page agree on where a
 * saved draft can be reopened.
 */
export function professorQuestionPath(questionId: string) {
  return `/professor/questions/${encodeURIComponent(questionId)}`;
}

export function professorReviewQueuePagePath(
  topicId: string,
  questionId?: string,
) {
  const params = new URLSearchParams({ topic: topicId });
  if (questionId) params.set("question", questionId);
  return `/professor/review?${params.toString()}`;
}

/**
 * Stable question IDs are slugs or namespaced identifiers. Anything else in a
 * hand-typed URL is rejected before it reaches a query.
 */
export function isProfessorQuestionId(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/u.test(value);
}
