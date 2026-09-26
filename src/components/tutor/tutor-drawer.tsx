"use client";

/**
 * The tutor: conversation beside the Sheet, never on top of it. Everything
 * the tutor says — a worked step, the misconception behind a wrong check, AI
 * help — arrives here, which is what lets the Sheet stay a clean worksheet.
 *
 * The header says what the tutor can see, in one line, before the student
 * types anything; once a session exists the chips name exactly that context
 * (the question, the hint rung, the last answer).
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
  "Work out your answer on the sheet. You can ask for a hint at any time.";

/** The id the collapse control points at (`aria-controls`). */
export const TUTOR_DRAWER_ID = "practice-tutor";

export type TutorContext = {
  questionCode: string;
  hintsRevealed: number;
  hintTotal: number;
  lastAnswer?: string;
};

export type TutorDrawerProps = {
  activeMode: TutorMode | "ai" | null;
  aiHelpAlreadyGiven: boolean;
  aiHelpEnabled: boolean;
  aiHelpOffered: boolean;
  busy: boolean;
  canCheck: boolean;
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
  onCheck: () => void;
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
  canCheck,
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
  onCheck,
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
  const logRef = useRef<HTMLDivElement>(null);
  const canSendPrompt =
    aiHelpOffered &&
    hasSession &&
    !busy &&
    !aiHelpAlreadyGiven &&
    prompt.trim().length > 0;

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
          <li>
            <StatusChip
              tone="neutral"
              icon={false}
              label={<span className="font-mono">{context.questionCode}</span>}
            />
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
          {context.lastAnswer ? (
            <li className="min-w-0 max-w-full">
              <StatusChip
                tone="neutral"
                icon={false}
                className="max-w-full"
                label={
                  <span className="min-w-0 truncate">
                    Last answer{" "}
                    <span className="font-mono">{context.lastAnswer}</span>
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
        className="flex min-h-32 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain"
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
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!canHint || busy}
            onClick={onHint}
          >
            {activeMode === "hint" ? "Hint…" : "Hint"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!canStep || busy}
            onClick={onStep}
          >
            {activeMode === "full_solution" ? "Step…" : "Step"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!canCheck || busy}
            onClick={onCheck}
          >
            {activeMode === "check" ? "Checking…" : "Check my work"}
          </Button>
          <Button asChild variant="secondary" size="sm">
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
              disabled={busy || !hasSession || aiHelpAlreadyGiven}
              onClick={onAskAi}
            >
              {activeMode === "ai" ? AI_HELP_PENDING_LABEL : "Ask AI for help"}
            </Button>
          ) : null}
        </div>

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
            disabled={!aiHelpEnabled || !hasSession || busy}
            placeholder={
              aiHelpEnabled
                ? "Ask the tutor…"
                : TUTOR_RULE_BASED_ONLY_PLACEHOLDER
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
          {Icon ? <Icon className="size-4 shrink-0" aria-hidden="true" /> : null}
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
