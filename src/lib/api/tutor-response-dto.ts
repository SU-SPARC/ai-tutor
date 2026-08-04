import "server-only";

import type { TutorResponse } from "@/lib/types";

export type TutorResponseDto = Omit<TutorResponse, "retrievedContext"> & {
  retrievedContext: [];
};

/**
 * Retrieval chunks are internal grounding records. Student clients receive the
 * resulting guidance and disclosure label, but never chunk bodies, identifiers,
 * metadata, or private-reference summaries as a retrieval payload.
 */
export function toTutorResponseDto(response: TutorResponse): TutorResponseDto {
  return {
    ...response,
    retrievedContext: [],
  };
}
