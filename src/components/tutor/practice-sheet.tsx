"use client";

/**
 * The middle column of /practice: THE SHEET, plus the two things that hang off
 * it — the ⋯ menu (start over, extra practice) and the report link under it.
 *
 * Everything here is presentational; every value and callback comes from the
 * workspace, which still owns the session, the transcript, and the hints.
 */

import { ArrowRight, CheckCircle2, Flag, MoreHorizontal } from "lucide-react";
import type { ReactNode, RefObject } from "react";

import { QuestionSheet } from "@/components/sheet/question-sheet";
import { QuestionFeedbackForm } from "@/components/tutor/question-feedback-form";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const STEPS_GATE_TEXT = "Available after 2 checks or from the tutor.";

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

export type PracticeSheetProps = {
  answer: string;
  answerDisabled: boolean;
  answerPlaceholder: string;
  checking: boolean;
  containerRef?: RefObject<HTMLDivElement | null>;
  continueButtonRef?: RefObject<HTMLButtonElement | null>;
  continueDisabled?: boolean;
  continueLabel: string;
  difficultyLabel: string;
  disclosedHints: string[];
  extraPractice?: ReactNode;
  feedbackKey?: string;
  footer?: ReactNode;
  helper: string;
  hintCount: number;
  hintRevealing: boolean;
  onAnswerChange: (value: string) => void;
  onCheck: () => void;
  onContinue: () => void;
  onRevealHint?: () => void;
  onRevealStep?: () => void;
  onStartOver: () => void;
  positionLabel?: string;
  prompt: string;
  questionCode: string;
  questionTitle: string;
  sessionId?: string;
  solutionSteps: string[];
  solved: boolean;
  startOverDisabled: boolean;
  stepCount: number;
  tombstone?: string;
  topicLabel: string;
  verdict?: "correct" | "incorrect" | null;
};

export function PracticeSheet({
  answer,
  answerDisabled,
  answerPlaceholder,
  checking,
  containerRef,
  continueButtonRef,
  continueDisabled = false,
  continueLabel,
  difficultyLabel,
  disclosedHints,
  extraPractice,
  feedbackKey,
  footer,
  helper,
  hintCount,
  hintRevealing,
  onAnswerChange,
  onCheck,
  onContinue,
  onRevealHint,
  onRevealStep,
  onStartOver,
  positionLabel,
  prompt,
  questionCode,
  questionTitle,
  sessionId,
  solutionSteps,
  solved,
  startOverDisabled,
  stepCount,
  tombstone,
  topicLabel,
  verdict,
}: PracticeSheetProps) {
  const sheetFooter = (
    <div className="flex flex-col gap-4">
      {solved ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3"
          role="status"
        >
          <p className="flex items-center gap-2 text-sm font-medium text-success">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Solved. Nice work.
          </p>
          <Button
            ref={continueButtonRef}
            type="button"
            variant="cta"
            size="sm"
            className="rounded-[6px]"
            disabled={continueDisabled}
            onClick={onContinue}
          >
            {continueLabel}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ) : null}
      {footer}
    </div>
  );

  return (
    <div className="flex flex-col gap-3" ref={containerRef}>
      <QuestionSheet
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
          placeholder: answerPlaceholder,
          value: answer,
          verdict,
        }}
        hints={{
          onReveal: onRevealHint,
          revealed: disclosedHints,
          revealing: hintRevealing,
          total: hintCount,
        }}
        steps={{
          gateText: STEPS_GATE_TEXT,
          onReveal: onRevealStep,
          revealed: solutionSteps,
          total: stepCount,
        }}
        menu={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 rounded-[6px]"
                aria-label="Question actions"
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuItem
                disabled={startOverDisabled}
                onSelect={() => onStartOver()}
              >
                Start over
              </DropdownMenuItem>
              {extraPractice ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Extra practice</DropdownMenuLabel>
                  <div className="px-2 pb-2">{extraPractice}</div>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        }
        footer={sheetFooter}
      />

      <div className="flex items-center gap-2 px-1 text-sm">
        <Flag
          className="size-4 shrink-0 text-muted-foreground"
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
