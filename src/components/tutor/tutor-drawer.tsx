"use client";

/**
 * The tutor: conversation beside the Sheet, never on top of it. Everything
 * the tutor says — a worked step, the misconception behind a wrong check, AI
 * help — arrives here, which is what lets the Sheet stay a clean worksheet.
 *
 * The header says what the tutor can see, in one line, before the student
 * types anything; once a session exists the context row names exactly that
 * (the question's first line, the hint rung, the answer in the field).
 *
 * The same body renders in the 1280+ drawer column (`variant="column"`, with
 * its own heading and collapse control) and inside the overlay below 1280
 * (`variant="sheet"`, where the dialog supplies the title).
 */

import {
  ArrowUpRight,
  CircleCheck,
  CircleHelp,
  CircleX,
  Info,
  PanelRightClose,
  Send,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { MathText } from "@/components/math/math-renderer";
import {
  AI_HELP_PENDING_LABEL,
  AI_HELP_REPEAT_NOTE,
} from "@/components/tutor/ai-help-request";
import type { ChatMessage } from "@/components/tutor/tutor-client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusChip } from "@/components/ui/status-chip";
import { Textarea } from "@/components/ui/textarea";
import type { TutorMode } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The privacy posture of the analytics doc, said once, where it matters. */
export const TUTOR_PRIVACY_NOTE =
  "Tutor sees this question, your hints so far, and your last attempt. Not your name.";

export const TUTOR_RULE_BASED_ONLY_PLACEHOLDER =
  "Typed questions are off right now.";

/** External scratch whiteboard for working a problem by hand. */
export const SKETCHPAD_URL = "https://interactive-sketchpad.onrender.com/";

export const TUTOR_EMPTY_TRANSCRIPT =
  "Stuck? Ask for a hint, or type a question like “Where do I start?”";

/** Why the typed-question box is off until the first check. */
export const TUTOR_ASK_AFTER_CHECK =
  "Check an answer first, then you can ask the tutor.";

/** Starter questions that fill the box (shown while AI help is on). */
export const TUTOR_SUGGESTIONS = [
  "Where do I start?",
  "What does this question ask?",
] as const;

/** The first line of a prompt, for the tutor's context row. */
export function promptFirstLine(prompt: string) {
  return (
    prompt
      .split(/\n+/)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith("$$")) ??
    prompt.trim()
  );
}

/** The id the collapse control points at (`aria-controls`). */
export const TUTOR_DRAWER_ID = "practice-tutor";

export type TutorContext = {
  /** The prompt's first line (KaTeX allowed), so the question stays in view. */
  promptLine: string;
  hintsRevealed: number;
  hintTotal: number;
  /** What is in the answer field now (or the last answer checked). */
  answer?: string;
};

export type TutorDrawerProps = {
  activeMode: TutorMode | "ai" | null;
  aiHelpAlreadyGiven: boolean;
  aiHelpEnabled: boolean;
  aiHelpOffered: boolean;
  busy: boolean;
  canHint: boolean;
  canStep: boolean;
  /** The collapse control, which receives focus when the drawer opens. */
  collapseButtonRef?: RefObject<HTMLButtonElement | null>;
  /** What the tutor can see, shown as chips once a session exists. */
  context?: TutorContext;
  hasSession: boolean;
  /** The heading, focused by "Why?" (column only). */
  headingRef?: RefObject<HTMLHeadingElement | null>;
  loading: boolean;
  messages: ChatMessage[];
  notice?: ReactNode;
  onAskAi: () => void;
  onCollapse?: () => void;
  onHint: () => void;
  onPromptChange: (value: string) => void;
  onSendPrompt: () => void;
  onStep: () => void;
  prompt: string;
  variant?: "column" | "sheet";
};

export function TutorDrawer({
  activeMode,
  aiHelpAlreadyGiven,
  aiHelpEnabled,
  aiHelpOffered,
  busy,
  canHint,
  canStep,
  collapseButtonRef,
  context,
  hasSession,
  headingRef,
  loading,
  messages,
  notice,
  onAskAi,
  onCollapse,
  onHint,
  onPromptChange,
  onSendPrompt,
  onStep,
  prompt,
  variant = "column",
}: TutorDrawerProps) {
  const headingId = useId();
  const promptId = useId();
  const promptNoteId = useId();
  const logRef = useRef<HTMLDivElement>(null);
  // The box and Send share one gate: a box that takes typing always sends.
  const canType = aiHelpOffered && hasSession && !busy && !aiHelpAlreadyGiven;
  const canSendPrompt = canType && prompt.trim().length > 0;
  const waitingForCheck = aiHelpEnabled && !aiHelpOffered;
  const hintTotal = context?.hintTotal ?? 0;
  const hintsRevealed = context?.hintsRevealed ?? 0;
  const hintButtonLabel =
    hintTotal > 0
      ? `Hint ${Math.min(hintsRevealed + 1, hintTotal)} of ${hintTotal}`
      : "Hint";

  // New entries scroll the transcript itself, never the window, in the
  // column and in the phone sheet alike.
  const entryCount = messages.length + (notice ? 1 : 0);
  useEffect(() => {
    const log = logRef.current;
    if (log) {
      log.scrollTop = log.scrollHeight;
    }
  }, [entryCount]);

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSendPrompt) {
        onSendPrompt();
      }
    }
  }

  const isColumn = variant === "column";

  return (
    <section
      id={isColumn ? TUTOR_DRAWER_ID : undefined}
      aria-labelledby={isColumn ? headingId : undefined}
      aria-label={isColumn ? undefined : "Tutor"}
      className="flex h-full min-h-0 flex-col gap-4"
      data-slot="tutor-drawer"
      data-tour={isColumn ? "practice-tutor" : undefined}
    >
      {isColumn ? (
        <header className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h2
              id={headingId}
              ref={headingRef}
              tabIndex={-1}
              className="type-h3 min-w-0 flex-1 text-ink focus-ring"
            >
              Tutor
            </h2>
            {onCollapse ? (
              <Button
                ref={collapseButtonRef}
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Collapse the tutor"
                aria-expanded
                aria-controls={TUTOR_DRAWER_ID}
                onClick={onCollapse}
              >
                <PanelRightClose aria-hidden="true" />
              </Button>
            ) : null}
          </div>
          <p className="type-caption max-w-prose">{TUTOR_PRIVACY_NOTE}</p>
        </header>
      ) : null}

      {context && hasSession ? (
        <ul
          aria-label="What the tutor can see"
          className="flex flex-wrap gap-1.5"
        >
          <li className="w-full min-w-0 rounded-control bg-surface-tint px-2.5 py-1.5">
            <MathText inline className="type-small line-clamp-1 text-ink">
              {context.promptLine}
            </MathText>
          </li>
          {context.hintTotal > 0 ? (
            <li>
              <StatusChip
                tone={context.hintsRevealed > 0 ? "hint" : "neutral"}
                icon={context.hintsRevealed > 0}
                label={
                  context.hintsRevealed > 0
                    ? `Hint ${context.hintsRevealed} of ${context.hintTotal}`
                    : "No hints yet"
                }
              />
            </li>
          ) : null}
          {context.answer ? (
            <li className="min-w-0 max-w-full">
              <StatusChip
                tone="neutral"
                icon={false}
                className="max-w-full"
                label={
                  <span className="min-w-0 truncate">
                    Your answer:{" "}
                    <span className="font-mono">{context.answer}</span>
                  </span>
                }
              />
            </li>
          ) : null}
        </ul>
      ) : null}

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label="Tutor conversation"
        className={cn(
          "flex flex-1 flex-col gap-3 overflow-y-auto overscroll-contain",
          isColumn ? "min-h-32" : "min-h-20",
        )}
      >
        {loading ? (
          <div className="flex flex-col gap-2" aria-hidden="true">
            <Skeleton className="h-12 w-4/5 rounded-l-none" />
            <Skeleton className="h-10 w-3/5 self-end" />
          </div>
        ) : messages.length === 0 && !notice ? (
          <p className="type-small max-w-prose text-ink-muted">
            {TUTOR_EMPTY_TRANSCRIPT}
          </p>
        ) : (
          messages.map((message) => (
            <ChatBubble key={message.id} message={message} />
          ))
        )}
        {notice}
      </div>

      <div className="flex flex-col gap-3 border-t border-rule pt-3">
        <div
          role="group"
          aria-label="Tutor actions"
          className="flex flex-wrap gap-2"
        >
          {hintTotal > 0 ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="pointer-coarse:h-11"
              disabled={!canHint || busy}
              loading={activeMode === "hint"}
              onClick={onHint}
            >
              {hintButtonLabel}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="pointer-coarse:h-11"
            disabled={!canStep || busy}
            loading={activeMode === "full_solution"}
            onClick={onStep}
          >
            Show steps
          </Button>
          <Button
            asChild
            variant="secondary"
            size="sm"
            className="pointer-coarse:h-11"
          >
            <a href={SKETCHPAD_URL} target="_blank" rel="noopener noreferrer">
              Sketchpad
              <ArrowUpRight aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </Button>
          {aiHelpOffered ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="pointer-coarse:h-11"
              disabled={busy || !hasSession || aiHelpAlreadyGiven}
              onClick={onAskAi}
            >
              {activeMode === "ai" ? AI_HELP_PENDING_LABEL : "Ask AI for help"}
            </Button>
          ) : null}
        </div>

        {aiHelpEnabled ? (
          <ul aria-label="Questions to ask" className="flex flex-wrap gap-1.5">
            {TUTOR_SUGGESTIONS.map((suggestion) => (
              <li key={suggestion}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-chip pointer-coarse:h-11"
                  disabled={!canType}
                  aria-describedby={waitingForCheck ? promptNoteId : undefined}
                  onClick={() => onPromptChange(suggestion)}
                >
                  {suggestion}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex items-end gap-2">
          <label htmlFor={promptId} className="sr-only">
            Ask the tutor
          </label>
          <Textarea
            id={promptId}
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            onKeyDown={handlePromptKeyDown}
            rows={2}
            disabled={!canType}
            aria-describedby={waitingForCheck ? promptNoteId : undefined}
            placeholder={
              !aiHelpEnabled
                ? TUTOR_RULE_BASED_ONLY_PLACEHOLDER
                : waitingForCheck
                  ? TUTOR_ASK_AFTER_CHECK
                  : "Ask the tutor…"
            }
            className="min-h-0 resize-none"
          />
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="pointer-coarse:size-11"
            aria-label="Send to the tutor"
            disabled={!canSendPrompt}
            onClick={onSendPrompt}
          >
            <Send aria-hidden="true" />
          </Button>
        </div>

        {waitingForCheck ? (
          <p id={promptNoteId} className="type-caption">
            {TUTOR_ASK_AFTER_CHECK}
          </p>
        ) : null}

        {aiHelpOffered && aiHelpAlreadyGiven && activeMode !== "ai" ? (
          <p className="type-caption">{AI_HELP_REPEAT_NOTE}</p>
        ) : null}
      </div>
    </section>
  );
}

const TONE_RULE: Record<NonNullable<ChatMessage["tone"]>, string> = {
  correct: "border-green-500",
  incorrect: "border-red-500",
  // Guidance is instructive (azure). Amber is reserved for the hint ladder.
  guidance: "border-azure-500",
  notice: "border-input",
  neutral: "border-rule",
};

const TONE_LABEL: Record<NonNullable<ChatMessage["tone"]>, string> = {
  correct: "text-green-700",
  incorrect: "text-red-700",
  guidance: "text-azure-700",
  notice: "text-ink",
  neutral: "text-ink",
};

/**
 * Student right, tutor left. Tone is a coloured rule on the tutor's edge, not
 * a filled card: the transcript stays readable when three wrong checks in a
 * row would otherwise turn the drawer red.
 */
export function ChatBubble({ message }: { message: ChatMessage }) {
  if (message.role === "student") {
    return (
      <div className="type-body ml-auto max-w-[85%] rounded-control bg-azure-100 px-3 py-2 break-words whitespace-pre-wrap text-ink">
        <span className="sr-only">You: </span>
        {message.text}
      </div>
    );
  }

  const tone = message.tone ?? "neutral";
  const Icon =
    tone === "correct"
      ? CircleCheck
      : tone === "incorrect"
        ? CircleX
        : tone === "guidance"
          ? CircleHelp
          : tone === "notice"
            ? Info
            : undefined;

  return (
    <div
      className={cn(
        "mr-auto flex w-full max-w-prose flex-col gap-1 rounded-r-control border-l-2 bg-sheet px-3 py-2 text-ink",
        TONE_RULE[tone],
      )}
    >
      {message.stepLabel ? (
        <p className="type-label">{message.stepLabel}</p>
      ) : null}
      {message.label ? (
        <p
          className={cn(
            "type-body-strong inline-flex items-center gap-1.5",
            TONE_LABEL[tone],
          )}
        >
          {Icon ? (
            <Icon className="size-4 shrink-0" aria-hidden="true" />
          ) : null}
          {message.label}
        </p>
      ) : null}
      <MathText className="type-body break-words">{message.text}</MathText>
      {message.note ? (
        <div className="type-small mt-1 rounded-control bg-surface-tint px-2.5 py-2 text-ink">
          <MathText>{message.note}</MathText>
        </div>
      ) : null}
    </div>
  );
}
