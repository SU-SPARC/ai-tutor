/**
 * The "All questions" · "Add a question" tab on the question bank page, as a
 * plain module: the server page reads `?tab=` through it and the client tabs
 * component writes it back, so neither side imports a helper across the
 * "use client" boundary. The URL values stay `bank` and `intake`.
 */
export type ProfessorQuestionsTab = "bank" | "intake";

export function professorQuestionsTabFromParam(
  value: string | null | undefined,
): ProfessorQuestionsTab {
  return value === "intake" ? "intake" : "bank";
}

/** Where the "Add a question" button goes. */
export const ADD_QUESTION_HREF = "/professor/questions?tab=intake";
