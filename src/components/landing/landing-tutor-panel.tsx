"use client";

import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type LandingTutorPanelProps = {
  messages: string[];
  onHint: () => void;
  onWhereToStart: () => void;
  hintDisabled?: boolean;
};

export const TUTOR_INTRO_MESSAGE = "Hi — I’ll nudge, not answer.";

export const WHERE_TO_START_MESSAGE =
  "Start by writing down what the problem gives you as probabilities. Then decide which of them is conditional on which.";

/**
 * The hero's tutor drawer. It is real — the hint chip drives the same session
 * the sheet does — but capped: free text needs an account, so the field is
 * disabled and says why instead of failing after a click.
 */
export function LandingTutorPanel({
  messages,
  onHint,
  onWhereToStart,
  hintDisabled = false,
}: LandingTutorPanelProps) {
  const inputId = useId();

  return (
    <section
      aria-label="Tutor"
      className="flex flex-col gap-4 rounded-lg border-l border-border bg-sheet p-4 text-sheet-foreground"
    >
      <h2 className="font-display text-base leading-none">Tutor</h2>

      <ol className="flex flex-col gap-2">
        {messages.map((message, index) => (
          <li
            key={`tutor-message-${index}`}
            className="rounded-lg bg-surface-tint px-3 py-2 text-sm leading-6"
          >
            {message}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onHint}
          disabled={hintDisabled}
          className="rounded-[6px]"
        >
          Give me a hint
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onWhereToStart}
          className="rounded-[6px]"
        >
          Where do I start?
        </Button>
      </div>

      <div className="flex flex-col gap-1">
        <label className="sr-only" htmlFor={inputId}>
          Ask the tutor
        </label>
        <Input
          id={inputId}
          disabled
          placeholder="Sign in to chat with the tutor"
          className="rounded-[6px]"
        />
      </div>
    </section>
  );
}
