import "server-only";

import { getApprovedQuestionById } from "@/lib/data/data-store";
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

/**
 * Student APIs must not echo a session's question binding unless that question
 * is still approved for publication. This also conceals legacy/corrupt
 * sessions that reference drafts without deleting their audit history.
 */
export async function toStudentTutorSessionDto(
  session: Pick<TutorSessionRecord, "id" | "questionId" | "status">,
) {
  if (session.status === "content_unpublished") {
    return undefined;
  }
  const question = await getApprovedQuestionById(session.questionId);
  return question ? toTutorSessionDto(session) : undefined;
}
