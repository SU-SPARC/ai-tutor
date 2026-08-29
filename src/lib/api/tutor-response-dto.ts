import "server-only";

import type { TutorResponse } from "@/lib/types";

export type TutorResponseDto = Omit<
  TutorResponse,
  "retrievedContext" | "usage"
> & {
  retrievedContext: [];
  usage: Omit<TutorResponse["usage"], "estimatedTokens">;
};

/**
 * Retrieval chunks are internal grounding records. Student clients receive the
 * resulting guidance and disclosure label, but never chunk bodies, identifiers,
 * metadata, private-reference summaries, or internal token estimates.
 */
export function toTutorResponseDto(response: TutorResponse): TutorResponseDto {
  return {
    ...response,
    retrievedContext: [],
    usage: {
      contextUsed: response.usage.contextUsed,
      fallbackUsed: response.usage.fallbackUsed,
      llmFallbackEligible: response.usage.llmFallbackEligible,
    },
  };
}
