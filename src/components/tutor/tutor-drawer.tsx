"use client";

/**
 * The tutor drawer: 380px of conversation beside the Sheet, never on top of
 * it. Everything the tutor says — a hint, a worked step, the misconception
 * behind a wrong check — arrives here, which is what lets the Sheet stay a
 * clean worksheet.
 *
 * The header says what the tutor can see, in one line, before the student
 * types anything.
 */

import { CheckCircle2, Info, Pencil, Send, X, XCircle } from "lucide-react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";

import { MathText } from "@/components/math/math-renderer";
import {
  AI_HELP_PENDING_LABEL,
  AI_HELP_REPEAT_NOTE,
} from "@/components/tutor/ai-help-request";
import type { ChatMessage } from "@/components/tutor/tutor-client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { TutorMode } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The privacy posture of the analytics doc, said once, where it matters. */
export const TUTOR_PRIVACY_NOTE =
  "Tutor sees this question, your hints so far, and your last attempt. Not your name.";

export const TUTOR_RULE_BASED_ONLY_PLACEHOLDER =
  "Rule-based help only right now.";

/** External scratch whiteboard for working a problem by hand. */
export const SKETCHPAD_URL = "https://interactive-sketchpad.onrender.com/";

export const TUTOR_EMPTY_TRANSCRIPT =
  "Work out your answer on the sheet. You can ask for a hint at any time.";

export type TutorDrawerProps = {
  activeMode: TutorMode | "ai" | null;
  aiHelpAlreadyGiven: boolean;
  aiHelpEnabled: boolean;
  aiHelpOffered: boolean;
  busy: boolean;
  canCheck: boolean;
  canHint: boolean;
  canStep: boolean;
  hasSession: boolean;
  loading: boolean;
  messages: ChatMessage[];
  messagesEndRef?: RefObject<HTMLDivElement | null>;
  notice?: ReactNode;
  onAskAi: () => void;
  onCheck: () => void;
  onCollapse?: () => void;
  onHint: () => void;
  onPromptChange: (value: string) => void;
  onSendPrompt: () => void;
  onStep: () => void;
  prompt: string;
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
  hasSession,
  loading,
  messages,
  messagesEndRef,
  notice,
  onAskAi,
  onCheck,
  onCollapse,
  onHint,
  onPromptChange,
  onSendPrompt,
  onStep,
  prompt,
}: TutorDrawerProps) {
  const canSendPrompt =
    aiHelpOffered &&
    hasSession &&
    !busy &&
    !aiHelpAlreadyGiven &&
    prompt.trim().length > 0;

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSendPrompt) {
        onSendPrompt();
      }
    }
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3"
      data-slot="tutor-drawer"
    >
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 font-display text-base font-normal">
          Tutor
        </h2>
        {onCollapse ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Collapse the tutor"
            onClick={onCollapse}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      <p className="text-xs leading-5 text-muted-foreground">
        {TUTOR_PRIVACY_NOTE}
      </p>

      <div
        role="log"
        aria-live="polite"
        aria-label="Tutor conversation"
        className="flex min-h-32 flex-1 flex-col gap-3 overflow-y-auto"
      >
        {loading ? (
          <div className="flex flex-col gap-2" aria-hidden="true">
            <Skeleton className="h-10 w-4/5 rounded-lg" />
            <Skeleton className="h-10 w-3/5 rounded-lg" />
          </div>
        ) : messages.length === 0 && !notice ? (
          <p className="text-sm leading-6 text-muted-foreground">
            {TUTOR_EMPTY_TRANSCRIPT}
          </p>
        ) : (
          messages.map((message) => (
            <ChatBubble key={message.id} message={message} />
          ))
        )}
        {notice}
        {messagesEndRef ? <div ref={messagesEndRef} /> : null}
      </div>

      <div className="flex flex-col gap-2 border-t border-border/50 pt-3">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-[6px]"
            disabled={!canHint || busy}
            onClick={onHint}
          >
            {activeMode === "hint" ? "Hint…" : "Hint"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-[6px]"
            disabled={!canStep || busy}
            onClick={onStep}
          >
            {activeMode === "full_solution" ? "Step…" : "Step"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-[6px]"
            disabled={!canCheck || busy}
            onClick={onCheck}
          >
            {activeMode === "check" ? "Checking…" : "Check my work"}
          </Button>
          <Button asChild variant="outline" size="sm" className="rounded-[6px]">
            <a href={SKETCHPAD_URL} target="_blank" rel="noopener noreferrer">
              <Pencil className="size-4" aria-hidden="true" />
              Sketchpad
            </a>
          </Button>
          {aiHelpOffered ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-[6px]"
              disabled={busy || !hasSession || aiHelpAlreadyGiven}
              onClick={onAskAi}
            >
              {activeMode === "ai" ? AI_HELP_PENDING_LABEL : "Ask AI for help"}
            </Button>
          ) : null}
        </div>

        <div className="flex items-end gap-2">
          <Textarea
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            onKeyDown={handlePromptKeyDown}
            rows={2}
            disabled={!aiHelpEnabled || !hasSession || busy}
            aria-label="Ask the tutor"
            placeholder={
              aiHelpEnabled
                ? "Ask the tutor…"
                : TUTOR_RULE_BASED_ONLY_PLACEHOLDER
            }
            className="min-h-0 resize-none rounded-[6px]"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-9 shrink-0 rounded-[6px]"
            aria-label="Send to the tutor"
            disabled={!canSendPrompt}
            onClick={onSendPrompt}
          >
            <Send className="size-4" aria-hidden="true" />
          </Button>
        </div>

        {aiHelpOffered && aiHelpAlreadyGiven && activeMode !== "ai" ? (
          <p className="text-xs leading-5 text-muted-foreground">
            {AI_HELP_REPEAT_NOTE}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Student right, tutor left. Tone is a coloured rule on the tutor's edge, not
 * a filled card: the transcript stays readable when three wrong checks in a
 * row would otherwise turn the drawer red.
 */
export function ChatBubble({ message }: { message: ChatMessage }) {
  if (message.role === "student") {
    return (
      <div className="ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-indigo-100 px-3 py-2 text-sm leading-6 whitespace-pre-wrap text-foreground">
        <span className="sr-only">You answered: </span>
        {message.text}
      </div>
    );
  }

  const tone = message.tone ?? "neutral";
  const Icon =
    tone === "correct"
      ? CheckCircle2
      : tone === "incorrect"
        ? XCircle
        : tone === "guidance" || tone === "notice"
          ? Info
          : undefined;

  return (
    <div
      className={cn(
        "mr-auto max-w-[95%] rounded-r-[6px] border-l-2 bg-sheet px-3 py-2 text-sm text-sheet-foreground",
        tone === "correct" && "border-success",
        tone === "incorrect" && "border-destructive",
        tone === "guidance" && "border-amber-500",
        tone === "notice" && "border-amber-500",
        tone === "neutral" && "border-border",
      )}
    >
      {message.stepLabel ? (
        <div className="mb-1 font-mono text-xs text-muted-foreground">
          {message.stepLabel}
        </div>
      ) : null}
      {message.label ? (
        <div
          className={cn(
            "mb-1 inline-flex items-center gap-1 text-xs font-medium",
            tone === "correct" && "text-success",
            tone === "incorrect" && "text-destructive",
            tone === "guidance" && "text-muted-foreground",
            tone === "notice" && "text-muted-foreground",
          )}
        >
          {Icon ? <Icon className="size-4" aria-hidden="true" /> : null}
          {message.label}
        </div>
      ) : null}
      <MathText className="leading-6">{message.text}</MathText>
      {message.note ? (
        <div className="mt-2 rounded-[6px] bg-surface-tint p-2 text-xs leading-5 text-muted-foreground">
          <MathText>{message.note}</MathText>
        </div>
      ) : null}
    </div>
  );
}
