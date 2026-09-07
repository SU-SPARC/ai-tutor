"use client";

import { useState } from "react";
import { Loader2, Shuffle } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { SimilarPracticeSessionDto } from "@/lib/types";

type SimilarProblemState = "idle" | "loading" | "none" | "error";

export function similarProblemStatusMessage(state: SimilarProblemState) {
  if (state === "none") {
    return "No additional approved practice problem is available for this question yet.";
  }
  if (state === "error") {
    return "A similar problem could not be checked right now. Try again.";
  }
  return undefined;
}

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
    <div className="border-t bg-success/5 px-5 py-3" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Ready for another?</p>
          {statusMessage ? (
            <p
              className={
                state === "error"
                  ? "text-xs text-destructive"
                  : "text-xs text-muted-foreground"
              }
            >
              {statusMessage}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Uses an optional professor-approved problem from Reserve. It does
              not count as assigned practice. No new problem is generated.
            </p>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || state === "loading"}
          onClick={() => void findSimilarProblem()}
        >
          {state === "loading" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Shuffle className="h-4 w-4" />
          )}
          Practice a similar problem
        </Button>
      </div>
    </div>
  );
}
