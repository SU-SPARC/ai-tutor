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
import { useId, type ReactNode, type RefObject } from "react";

import { MathText } from "@/components/math/math-renderer";
import { QuestionSheet } from "@/components/sheet/question-sheet";
import { BottomBar } from "@/components/shell/bottom-bar";
import { QuestionFeedbackForm } from "@/components/tutor/question-feedback-form";
import { parsedAnswerPreview } from "@/components/tutor/tutor-client";
import type { SheetVerdict } from "@/components/tutor/use-practice-workspace";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export const STEPS_GATE_TEXT = "Available once every hint is shown.";

/** Shown under "Steps" once the hint ladder is used up. */
export const STEPS_READY_TEXT = "Ready. Show steps opens the worked solution.";

/**
 * The Sheet header names the shape of the expected answer, not the answer
 * rules. The server already wrote a plain-language hint; this reduces it to
 * the one word that belongs in a mono header line.
 */
export function answerTypeFromHint(inputFormatHint: string) {
  return /decimal|fraction|percent|number|numeric|digit/i.test(inputFormatHint)
    ? "numeric"
    : "text";
}

/**
 * How a numeric entry reads, typeset under the answer field ("Reads as
 * 1/4 = 0.25" in KaTeX) once it parses. Nothing renders while the entry does
 * not parse, so the line never shows an error mid-typing.
 */
export function answerPreview(answer: string, formatHint: string) {
  if (answerTypeFromHint(formatHint) !== "numeric") {
    return undefined;
  }
  const preview = parsedAnswerPreview(answer);
  return preview ? (
    <p>
      Reads as <MathText>{`$${preview.latex}$`}</MathText>
    </p>
  ) : undefined;
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
  positionLabel?: string;
  prompt: string;
  questionCode: string;
  questionTitle: string;
  sessionId?: string;
  solutionSteps: string[];
  startOverDisabled: boolean;
  stepCount: number;
  /** The hint ladder is used up, so the worked steps can open. */
  stepsReady: boolean;
  tombstone?: string;
  topicLabel: string;
  verdict?: SheetVerdict | null;
};

export function PracticeSheet({
  answer,
  answerDisabled,
  checking,
  containerRef,
  difficultyLabel,
  disclosedHints,
  extraPractice,
  feedbackKey,
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
  stepsReady,
  tombstone,
  topicLabel,
  verdict,
}: PracticeSheetProps) {
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
        header={{
          answerType: answerTypeFromHint(helper),
          difficultyLabel,
          positionLabel,
          questionCode,
          topicLabel,
        }}
        prompt={prompt}
        tombstone={tombstone}
        answer={{
          checking,
          disabled: answerDisabled,
          helper,
          onChange: onAnswerChange,
          onCheck,
          // The action strip carries the one Check answer button.
          preview: answerPreview(answer, helper),
          showCheck: false,
          value: answer,
          verdict: verdict?.verdict ?? null,
          verdictMessage: verdict?.message,
        }}
        // The reveal control lives in the action strip, so the Sheet shows
        // only the rungs already opened (and nothing before the first).
        hints={{
          revealControl: false,
          revealed: disclosedHints,
          total: hintTotal,
        }}
        steps={
          stepCount > 0
            ? {
                gateText:
                  stepsReady && solutionSteps.length === 0
                    ? STEPS_READY_TEXT
                    : STEPS_GATE_TEXT,
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
                aria-label="Question actions"
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                disabled={startOverDisabled}
                onSelect={() => onStartOver()}
              >
                Start over
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
        footer={sheetFooter}
      />

      <div className="flex items-start gap-2 px-1">
        <Flag
          className="mt-0.5 size-4 shrink-0 text-ink-muted"
          aria-hidden="true"
        />
        <QuestionFeedbackForm
          key={feedbackKey}
          questionTitle={questionTitle}
          sessionId={sessionId}
        />
      </div>
    </div>
  );
}

type StripControl = {
  disabled: boolean;
  label: string;
  loading: boolean;
  onReveal: () => void;
  /** Why it is disabled, read with the control and shown as its tooltip. */
  reason?: string;
};

export type PracticeActionStripProps = {
  canCheck: boolean;
  checking: boolean;
  continueButtonRef?: RefObject<HTMLButtonElement | null>;
  continueDisabled: boolean;
  continueLabel: string;
  /** Hint control; `null` when the question has no hints. */
  hint: StripControl | null;
  onCheck: () => void;
  onContinue: () => void;
  onWhy?: () => void;
  solved: boolean;
  /** Show-steps control; `null` when there is nothing left to show. */
  step: StripControl | null;
  /** Replaces the primary after "Finish topic" (a link to the syllabus). */
  topicDone?: { href: string; label: string };
};

/**
 * The action strip: secondary help on the left, the ONE primary on the
 * right. Below 1024 it is the fixed phone bar (a 44px hint square beside a
 * full-width primary); from 1024 it sticks to the bottom of the main column.
 */
export function PracticeActionStrip({
  canCheck,
  checking,
  continueButtonRef,
  continueDisabled,
  continueLabel,
  hint,
  onCheck,
  onContinue,
  onWhy,
  solved,
  step,
  topicDone,
}: PracticeActionStripProps) {
  const hintReasonId = useId();
  const stepReasonId = useId();

  const start = solved ? (
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
            className="size-11 px-0 lg:h-10 lg:w-auto lg:px-3"
            disabled={hint.disabled}
            loading={hint.loading}
            onClick={hint.onReveal}
            title={hint.reason}
            aria-describedby={hint.reason ? hintReasonId : undefined}
          >
            <Lightbulb
              aria-hidden="true"
              className="size-5 text-amber-500 lg:size-4"
            />
            <span className="sr-only lg:not-sr-only">{hint.label}</span>
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
              "size-11 px-0 lg:h-10 lg:w-auto lg:px-3",
              // On phones the square only appears once it does something.
              step.disabled && "max-lg:hidden",
            )}
            disabled={step.disabled}
            loading={step.loading}
            onClick={step.onReveal}
            title={step.reason}
            aria-describedby={step.reason ? stepReasonId : undefined}
          >
            <ListOrdered aria-hidden="true" className="size-5 lg:size-4" />
            <span className="sr-only lg:not-sr-only">{step.label}</span>
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

  const primary = topicDone ? (
    <Button asChild variant="cta" size="lg" className="w-full lg:w-auto">
      <Link href={topicDone.href}>
        {topicDone.label}
        <ArrowRight aria-hidden="true" />
      </Link>
    </Button>
  ) : solved ? (
    <Button
      ref={continueButtonRef}
      type="button"
      variant="cta"
      size="lg"
      className="w-full lg:w-auto"
      disabled={continueDisabled}
      onClick={onContinue}
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
      disabled={!canCheck}
      loading={checking}
      onClick={onCheck}
    >
      Check answer
    </Button>
  );

  return (
    <BottomBar
      label="Answer actions"
      hideFrom={false}
      className="lg:sticky lg:bottom-0 lg:z-10 lg:-mx-8 lg:mt-6"
      start={start ?? undefined}
      end={<div className="flex justify-end">{primary}</div>}
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
  headingLevel = 2,
  headingRef,
  solvedCount,
  topicTitle,
  total,
}: {
  actions?: ReactNode;
  headingLevel?: 2 | 3;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  solvedCount: number;
  topicTitle?: string;
  total: number;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="flex flex-col gap-2 rounded-r-control border-l-2 border-green-500 bg-sheet py-2 pr-2 pl-4 text-ink">
      <Heading
        ref={headingRef}
        tabIndex={headingRef ? -1 : undefined}
        className="type-h3 text-ink focus-ring"
      >
        Topic complete
      </Heading>
      <p className="type-body max-w-prose text-ink-muted">
        You worked through every available question in{" "}
        {topicTitle ?? "this topic"}
        {total > 0 ? ` (${solvedCount} of ${total} solved this visit)` : ""}.
      </p>
      {actions ? (
        <div className="mt-1 flex flex-wrap gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
