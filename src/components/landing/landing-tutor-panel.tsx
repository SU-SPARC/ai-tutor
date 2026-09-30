"use client";

import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type LandingTutorPanelProps = {
  messages: string[];
  onHint: () => void;
  onWhereToStart: () => void;
  hintDisabled?: boolean;
  /**
   * Signed out: both buttons and the text box are disabled, and the line
   * under them says how to open the tutor.
   */
  locked?: boolean;
};

export const LOCKED_TUTOR_NOTE =
  "Sign in or join your course to use the tutor.";

export const TUTOR_INTRO_MESSAGE = "Hi — I’ll nudge, not answer.";

export const WHERE_TO_START_MESSAGE =
  "Start by writing down what the problem gives you as probabilities. Then decide which of them is conditional on which.";

/**
 * The hero's tutor panel. It is real — the hint button drives the same
 * session the sheet does — but capped: free text needs an account, so the
 * field is disabled and the line under it says why instead of failing after
 * a click.
 *
 * Tutor lines carry an azure left rule, never a filled bubble: the transcript
 * reads as margin notes beside the worksheet.
 */
export function LandingTutorPanel({
  messages,
  onHint,
  onWhereToStart,
  hintDisabled = false,
  locked = false,
}: LandingTutorPanelProps) {
  const headingId = useId();
  const inputId = useId();
  const noteId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-5 text-ink"
    >
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="type-h2 text-ink">
          Tutor
        </h2>
        <p className="type-caption">
          Sees this problem, your hints and your last answer. Not your name.
        </p>
      </div>

      <div role="log" aria-label="Tutor messages">
        <ol className="flex flex-col gap-3">
          {messages.map((message, index) => (
            <li
              key={`tutor-message-${index}`}
              className="type-body border-l-2 border-azure-500 pl-3 text-ink"
            >
              {message}
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onHint}
          disabled={locked || hintDisabled}
          aria-describedby={locked ? noteId : undefined}
        >
          Give me a hint
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onWhereToStart}
          disabled={locked}
          aria-describedby={locked ? noteId : undefined}
        >
          Where do I start?
        </Button>
      </div>

      <div className="flex flex-col gap-2 border-t border-rule pt-4">
        <label className="sr-only" htmlFor={inputId}>
          Ask the tutor
        </label>
        <Input
          id={inputId}
          disabled
          placeholder="Ask about this problem…"
          aria-describedby={noteId}
        />
        <p id={noteId} className="type-caption">
          {locked ? LOCKED_TUTOR_NOTE : "Sign in to chat with the tutor."}
        </p>
      </div>
    </section>
  );
}
