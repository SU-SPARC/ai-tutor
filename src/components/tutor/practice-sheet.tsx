"use client";

/**
 * The middle column of /practice: THE SHEET, the sticky action strip under
 * it, and the things that hang off the Sheet (the ⋯ menu, the topic-complete
 * notice, the similar-problem offer, the report link).
 *
 * Everything here is presentational; every value and callback comes from
 * `usePracticeWorkspace`, which owns the session, the transcript and the
 * ladders.
 */

import Link from "next/link";
import {
  ArrowRight,
  Flag,
  Lightbulb,
  ListOrdered,
  MoreHorizontal,
} from "lucide-react";
import { useId, useState, type ReactNode, type RefObject } from "react";

import { AnswerReading } from "@/components/math/math-answer-field";
import { QuestionSheet } from "@/components/sheet/question-sheet";
import { BottomBar } from "@/components/shell/bottom-bar";
import { QuestionFeedbackForm } from "@/components/tutor/question-feedback-form";
import { parsedAnswerPreview } from "@/components/tutor/tutor-client";
import type { SheetVerdict } from "@/components/tutor/use-practice-workspace";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  answerNotationFromHint,
  answerTypeFromHint,
  formatHintAsksForPercent,
  type AnswerEntry,
} from "@/lib/math/answer-notation";
import type { QuestionFigure } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The Sheet header names the shape of the expected answer, not the answer
 * rules. The server already wrote a plain-language hint; this reduces it to
 * the one word that belongs in a mono header line. (One helper for practice
 * and the landing hero, in `answer-notation.ts`.)
 */
export { answerTypeFromHint };

/**
 * How a numeric entry reads, typeset under the answer field ("Reads as
 * 1/4 = 0.25" in KaTeX) once it parses; "· checked as 1/8" when the field
 * evaluated an expression, or a one-line hint for a decimal comma or a mixed
 * number. Nothing renders while the entry does not parse, so the line never
 * shows an error mid-typing. Inline `Math` only: no block inside the `<p>`.
 */
export function answerPreview(
  answer: string,
  formatHint: string,
  entry?: AnswerEntry,
) {
  if (answerTypeFromHint(formatHint) !== "numeric") {
    return undefined;
  }
  const preview = parsedAnswerPreview(answer, entry);
  return preview ? <AnswerReading preview={preview} /> : undefined;
}

export type PracticeSheetProps = {
  answer: string;
  answerDisabled: boolean;
  checking: boolean;
  containerRef?: RefObject<HTMLDivElement | null>;
  difficultyLabel: string;
  disclosedHints: string[];
  /** The similar-problem offer, shown once the question is finished. */
  extraPractice?: ReactNode;
  feedbackKey?: string;
  /** The graph that belongs to the prompt, if the question has one. */
  figure?: QuestionFigure;
  /** Prev · pips · next. */
  footer?: ReactNode;
  /** The plain-language format hint for the answer. */
  helper: string;
  /** Hints the question has; the reveal control lives in the action strip. */
  hintTotal: number;
  /** The topic-complete notice. */
  notice?: ReactNode;
  onAnswerChange: (value: string) => void;
  onCheck: () => void;
  onStartOver: () => void;
  /** "Question 1 of 6". */
  positionLabel?: string;
  prompt: string;
  /** Shown only in the report form's caption, never in the header. */
  questionCode: string;
  questionTitle: string;
  sessionId?: string;
  solutionSteps: string[];
  startOverDisabled: boolean;
  stepCount: number;
  tombstone?: string;
  /** "Week 3 · Conditional probability". */
  topicLabel: string;
  verdict?: SheetVerdict | null;
  /** The next move inside the verdict band ("Show hint 2 of 3"). */
  verdictAction?: ReactNode;
};

/** The Start over confirmation, in the contract's words. */
export const START_OVER_TITLE = "Start this question over?";
export const START_OVER_BODY =
  "Your earlier answers stay saved. Hints and steps close again.";

export function PracticeSheet({
  answer,
  answerDisabled,
  checking,
  containerRef,
  difficultyLabel,
  disclosedHints,
  extraPractice,
  feedbackKey,
  figure,
  footer,
  helper,
  hintTotal,
  notice,
  onAnswerChange,
  onCheck,
  onStartOver,
  positionLabel,
  prompt,
  questionCode,
  questionTitle,
  sessionId,
  solutionSteps,
  startOverDisabled,
  stepCount,
  tombstone,
  topicLabel,
  verdict,
  verdictAction,
}: PracticeSheetProps) {
  const [confirmStartOver, setConfirmStartOver] = useState(false);
  const sheetFooter =
    notice || extraPractice || footer ? (
      <div className="flex flex-col gap-5">
        {notice}
        {extraPractice}
        {footer}
      </div>
    ) : undefined;

  return (
    <div className="flex flex-col gap-3" ref={containerRef}>
      <QuestionSheet
        title={questionTitle}
        headingLevel={1}
        // Where am I, in words: no question code, no answer-type word.
        header={{
          difficultyLabel,
          positionLabel,
          topicLabel,
        }}
        prompt={prompt}
        figure={figure}
        tombstone={tombstone}
        answer={{
          checking,
          disabled: answerDisabled,
          helper,
          onChange: onAnswerChange,
          onCheck,
          emphasizeKey: formatHintAsksForPercent(helper)
            ? "percent"
            : undefined,
          notation: answerNotationFromHint(helper),
          preview: (entry) => answerPreview(answer, helper, entry),
          // The action strip carries the one Check answer button (and the
          // keypad drops its own Check key).
          showCheck: false,
          value: answer,
          verdict: verdict?.verdict ?? null,
          verdictAction,
          verdictMessage: verdict?.message,
        }}
        // The reveal control lives in the action strip; the Sheet shows the
        // hint → steps sequence and the rungs already opened.
        hints={{
          revealControl: false,
          revealed: disclosedHints,
          total: hintTotal,
        }}
        steps={
          stepCount > 0
            ? {
                hideUntilRevealed: true,
                revealed: solutionSteps,
                total: stepCount,
              }
            : undefined
        }
        menu={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="pointer-coarse:size-11"
                aria-label="Question actions"
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                disabled={startOverDisabled}
                onSelect={() => setConfirmStartOver(true)}
              >
                Start over
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
        footer={sheetFooter}
      />

      <Dialog open={confirmStartOver} onOpenChange={setConfirmStartOver}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle className="type-h3">{START_OVER_TITLE}</DialogTitle>
            <DialogDescription>{START_OVER_BODY}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="pointer-coarse:h-11"
              onClick={() => setConfirmStartOver(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="pointer-coarse:h-11"
              onClick={() => {
                setConfirmStartOver(false);
                onStartOver();
              }}
            >
              Start over
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex items-start gap-2 px-1">
        <Flag
          className="mt-0.5 size-4 shrink-0 text-ink-muted"
          aria-hidden="true"
        />
        <QuestionFeedbackForm
          key={feedbackKey}
          questionCode={questionCode}
          questionTitle={questionTitle}
          sessionId={sessionId}
        />
      </div>
    </div>
  );
}

type StripControl = {
  disabled: boolean;
  /** Desktop words: "Show hint 2 of 3", "Show steps". */
  label: string;
  /** Phone words, always visible: "Hint 2/3". Defaults to `label`. */
  shortLabel?: string;
  loading: boolean;
  onReveal: () => void;
  /** Why it is disabled, read with the control and shown as its tooltip. */
  reason?: string;
  /** Hidden below 1024 (phones keep at most two controls by the primary). */
  hideOnPhone?: boolean;
};

export type PracticeActionStripProps = {
  canCheck: boolean;
  /**
   * The Check answer label; after a wrong answer, while the field is
   * unchanged, "Edit your answer to check again".
   */
  checkLabel?: string;
  checking: boolean;
  /** The solved-state primary (a button, or the Next topic link). */
  continueButtonRef?: RefObject<HTMLElement | null>;
  continueDisabled: boolean;
  continueLabel: string;
  /** Accessible name for the continue button ("Next unsolved question: …"). */
  continueAriaLabel?: string;
  /** Hint control; `null` when the question has no hints. */
  hint: StripControl | null;
  /**
   * The topic is finished: the solved-state primary becomes a link to the
   * next topic ("Next topic: Week 4 · Bayes' rule"), or "Back to Learn".
   */
  nextTopic?: { href: string; label: string };
  onCheck: () => void;
  onContinue: () => void;
  onWhy?: () => void;
  /**
   * The question was removed: no help controls, and the one primary moves on
   * ("Next question", or the next-topic link).
   */
  retired?: boolean;
  solved: boolean;
  /** Show-steps control; `null` when there is nothing left to show. */
  step: StripControl | null;
};

/**
 * The action strip: secondary help on the left, the ONE primary on the
 * right. Below 1024 it is the fixed phone bar ("Hint 1/3" beside a
 * full-width primary); from 1024 it sticks to the bottom of the main column.
 */
export function PracticeActionStrip({
  canCheck,
  checkLabel = "Check answer",
  checking,
  continueButtonRef,
  continueDisabled,
  continueLabel,
  continueAriaLabel,
  hint,
  nextTopic,
  onCheck,
  onContinue,
  onWhy,
  retired = false,
  solved,
  step,
}: PracticeActionStripProps) {
  const hintReasonId = useId();
  const stepReasonId = useId();
  const moveOn = solved || retired;

  const start = retired ? null : solved ? (
    onWhy ? (
      <Button
        type="button"
        variant="secondary"
        className="pointer-coarse:h-11"
        onClick={onWhy}
      >
        Why?
      </Button>
    ) : null
  ) : (
    <>
      {hint ? (
        <>
          <Button
            type="button"
            variant="secondary"
            className={cn(
              "h-11 px-3 lg:h-10",
              hint.hideOnPhone && "max-lg:hidden",
            )}
            disabled={hint.disabled}
            loading={hint.loading}
            onClick={hint.onReveal}
            title={hint.reason}
            aria-label={hint.label}
            aria-describedby={hint.reason ? hintReasonId : undefined}
          >
            <Lightbulb
              aria-hidden="true"
              className="size-5 text-amber-500 lg:size-4"
            />
            <span aria-hidden="true" className="tabular lg:hidden">
              {hint.shortLabel ?? hint.label}
            </span>
            <span aria-hidden="true" className="max-lg:hidden">
              {hint.label}
            </span>
          </Button>
          {hint.reason ? (
            <span id={hintReasonId} hidden>
              {hint.reason}
            </span>
          ) : null}
        </>
      ) : null}
      {step ? (
        <>
          <Button
            type="button"
            variant="ghost"
            className={cn(
              "h-11 px-3 lg:h-10",
              // On phones the button only appears once it does something;
              // the Sheet's Steps pip says when that will be.
              (step.disabled || step.hideOnPhone) && "max-lg:hidden",
            )}
            disabled={step.disabled}
            loading={step.loading}
            onClick={step.onReveal}
            title={step.reason}
            aria-describedby={step.reason ? stepReasonId : undefined}
          >
            <ListOrdered aria-hidden="true" className="size-5 lg:size-4" />
            {step.label}
          </Button>
          {step.reason ? (
            <span id={stepReasonId} hidden>
              {step.reason}
            </span>
          ) : null}
        </>
      ) : null}
    </>
  );

  const primary =
    moveOn && nextTopic ? (
      <Button asChild variant="cta" size="lg" className="w-full lg:w-auto">
        <Link
          ref={continueButtonRef as RefObject<HTMLAnchorElement | null>}
          href={nextTopic.href}
          data-slot="practice-primary"
        >
          <span className="truncate">{nextTopic.label}</span>
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    ) : moveOn ? (
      <Button
        ref={continueButtonRef as RefObject<HTMLButtonElement | null>}
        type="button"
        variant="cta"
        size="lg"
        className="w-full lg:w-auto"
        data-slot="practice-primary"
        disabled={continueDisabled}
        onClick={onContinue}
        aria-label={continueAriaLabel}
      >
        {continueLabel}
        <ArrowRight aria-hidden="true" />
      </Button>
    ) : (
      <Button
        type="button"
        variant="cta"
        size="lg"
        className="w-full lg:w-auto lg:min-w-40"
        data-slot="practice-primary"
        disabled={!canCheck}
        loading={checking}
        onClick={onCheck}
      >
        {checkLabel}
      </Button>
    );

  return (
    <BottomBar
      label="Answer actions"
      hideFrom={false}
      className="lg:sticky lg:bottom-0 lg:z-10 lg:-mx-8 lg:mt-6"
      start={start ?? undefined}
      end={<div className="flex min-w-0 justify-end">{primary}</div>}
    />
  );
}

/**
 * "Topic complete": the one quiet moment. It renders in the Sheet (so it is
 * seen without the tutor) with its actions, and in the tutor transcript as a
 * plain entry.
 */
export function TopicCompleteNotice({
  actions,
  courseComplete = false,
  headingLevel = 2,
  headingRef,
  topicTitle,
  total,
}: {
  actions?: ReactNode;
  /** Every question on the syllabus is solved. */
  courseComplete?: boolean;
  headingLevel?: 2 | 3;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  topicTitle?: string;
  total: number;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div
      data-slot="topic-complete"
      className="flex flex-col gap-2 rounded-r-control border-l-2 border-green-500 bg-sheet py-2 pr-2 pl-4 text-ink"
    >
      <Heading
        ref={headingRef}
        tabIndex={headingRef ? -1 : undefined}
        className="type-h3 text-ink focus-ring"
      >
        Topic complete
      </Heading>
      <p className="type-body max-w-prose text-ink-muted">
        {topicCompleteSentence(total, topicTitle)}
        {courseComplete ? ` ${COURSE_COMPLETE_SENTENCE}` : ""}
      </p>
      {actions ? (
        <div className="mt-1 flex flex-wrap gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

export const COURSE_COMPLETE_SENTENCE =
  "You’ve solved every question on the syllabus.";

/** "You solved all 6 questions in Conditional probability." */
export function topicCompleteSentence(total: number, topicTitle?: string) {
  const where = topicTitle ?? "this topic";
  if (total === 1) {
    return `You solved the question in ${where}.`;
  }
  return `You solved all ${total} questions in ${where}.`;
}
