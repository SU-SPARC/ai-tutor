/**
 * The Bank · Intake tab on the questions page, as a plain module: the server
 * page reads `?tab=` through it and the client tabs component writes it back,
 * so neither side imports a helper across the "use client" boundary.
 */
export type ProfessorQuestionsTab = "bank" | "intake";

export function professorQuestionsTabFromParam(
  value: string | undefined,
): ProfessorQuestionsTab {
  return value === "intake" ? "intake" : "bank";
}
