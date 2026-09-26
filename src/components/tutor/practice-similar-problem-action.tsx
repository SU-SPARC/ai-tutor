"use client";

import { useState } from "react";
import { Loader2, Shuffle } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { SimilarPracticeSessionDto } from "@/lib/types";

type SimilarProblemState =
  | "idle"
  | "loading"
  | "none"
  | "not_qualified"
  | "error";

export function similarProblemStatusMessage(state: SimilarProblemState) {
  if (state === "none") {
    return "No similar problem is available right now. You can continue to the next question or choose another topic.";
  }
  if (state === "not_qualified") {
    return "A similar problem opens once you have checked three answers and opened the worked solution, or solved the question.";
  }
  if (state === "error") {
    return "We couldn't look for a similar problem just now. You can try again or continue.";
  }
  return undefined;
}

export const SIMILAR_PROBLEM_DESCRIPTION =
  "Optional extra practice on a professor-approved problem like this one. Solving it can count toward partial practice credit under your instructor's policy.";

export function PracticeSimilarProblemAction({
  disabled,
  onMatch,
  sessionId,
}: {
  disabled: boolean;
  onMatch: (practice: SimilarPracticeSessionDto) => void;
  sessionId: string;
}) {
  const [state, setState] = useState<SimilarProblemState>("idle");
  const statusMessage = similarProblemStatusMessage(state);

  async function findSimilarProblem() {
    setState("loading");
    try {
      const response = await fetch(
        `/api/tutor/session/${encodeURIComponent(sessionId)}/similar`,
        {
          headers: { Accept: "application/json" },
          method: "POST",
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        code?: string;
        practice?: SimilarPracticeSessionDto | null;
      };
      if (!response.ok) {
        setState(
          response.status === 409 && payload.code === "TUTOR_SESSION_NOT_COMPLETE"
            ? "not_qualified"
            : "error",
        );
        return;
      }
      if (!payload.practice) {
        setState("none");
        return;
      }
      onMatch(payload.practice);
    } catch {
      setState("error");
    }
  }

  return (
    <div className="flex flex-col items-start gap-2" aria-live="polite">
      <Button
        type="button"
        variant="secondary"
        className="pointer-coarse:h-11"
        disabled={
          disabled ||
          state === "loading" ||
          state === "none" ||
          state === "not_qualified"
        }
        onClick={() => void findSimilarProblem()}
      >
        {state === "loading" ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Shuffle aria-hidden="true" />
        )}
        {state === "loading" ? "Looking for a problem…" : "Try a similar problem"}
      </Button>
      <p
        className={
          state === "error"
            ? "type-small max-w-prose text-ink"
            : "type-small max-w-prose text-ink-muted"
        }
      >
        {statusMessage ?? SIMILAR_PROBLEM_DESCRIPTION}
      </p>
    </div>
  );
}
