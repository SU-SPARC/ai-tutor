import type { TutorSessionRecord } from "@/lib/types";

export type TutorSessionDto = {
  id: string;
  questionId: string;
};

/**
 * Browser clients need only the opaque session id and its question binding.
 * Attempts, answer previews, ownership identifiers, and timestamps stay on the
 * server for progress derivation and auditing.
 */
export function toTutorSessionDto(
  session: Pick<TutorSessionRecord, "id" | "questionId">,
): TutorSessionDto {
  return {
    id: session.id,
    questionId: session.questionId,
  };
}
