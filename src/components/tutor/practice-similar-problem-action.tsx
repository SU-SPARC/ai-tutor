"use client";

import { useState } from "react";
import { Loader2, Shuffle } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { SimilarPracticeSessionDto } from "@/lib/types";

type SimilarProblemState = "idle" | "loading" | "none" | "error";

export function similarProblemStatusMessage(state: SimilarProblemState) {
  if (state === "none") {
    return "No similar problem is available right now. You can continue to the next question or choose another topic.";
  }
  if (state === "error") {
    return "We couldn't look for a similar problem just now. You can try again or continue.";
  }
  return undefined;
}

export const SIMILAR_PROBLEM_DESCRIPTION =
  "Optional extra practice on a professor-approved problem like this one. It does not count toward your assigned practice.";

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
        practice?: SimilarPracticeSessionDto | null;
      };
      if (!response.ok) {
        setState("error");
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
    <div
      className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3"
      aria-live="polite"
    >
      <Button
        type="button"
        variant="outline"
        className="shrink-0"
        disabled={disabled || state === "loading" || state === "none"}
        onClick={() => void findSimilarProblem()}
      >
        {state === "loading" ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Shuffle className="h-4 w-4" aria-hidden="true" />
        )}
        {state === "loading" ? "Looking for a problem…" : "Try a similar problem"}
      </Button>
      {statusMessage ? (
        <p
          className={
            state === "error"
              ? "min-w-0 text-xs leading-5 text-destructive"
              : "min-w-0 text-xs leading-5 text-muted-foreground"
          }
        >
          {statusMessage}
        </p>
      ) : (
        <p className="min-w-0 text-xs leading-5 text-muted-foreground">
          {SIMILAR_PROBLEM_DESCRIPTION}
        </p>
      )}
    </div>
  );
}
