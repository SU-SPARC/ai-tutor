"use client";

import { ChevronRight } from "lucide-react";
import { useId, type KeyboardEvent, type ReactNode } from "react";

import { MathText } from "@/components/math/math-renderer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type SheetHint = {
  index: number;
  /** `undefined` means "not revealed yet". */
  text?: string;
};

export type QuestionSheetHeader = {
  topicLabel: string;
  positionLabel?: string;
  questionCode: string;
  answerType: string;
  difficultyLabel?: string;
};

export type QuestionSheetAnswer = {
  value: string;
  onChange: (value: string) => void;
  onCheck: () => void;
  disabled?: boolean;
  placeholder?: string;
  helper?: string;
  verdict?: "correct" | "incorrect" | null;
  checking?: boolean;
  attemptsLeft?: number;
};

export type QuestionSheetHints = {
  total: number;
  revealed: string[];
  onReveal?: () => void;
  revealing?: boolean;
  gateText?: string;
};

export type QuestionSheetSteps = {
  revealed: string[];
  total?: number;
  gateText?: string;
  onReveal?: () => void;
};

export type QuestionSheetProps = {
  header: QuestionSheetHeader;
  /** Rendered with `<MathText>`; `$...$` and `$$...$$` become KaTeX. */
  prompt: string;
  answer?: QuestionSheetAnswer;
  hints: QuestionSheetHints;
  steps?: QuestionSheetSteps;
  /** Prev / next pips. */
  footer?: ReactNode;
  /** The ⋯ menu. */
  menu?: ReactNode;
  /** `content_unpublished`: replaces the prompt and the answer block. */
  tombstone?: string;
  /** Collapsed row variant for lists and professor previews. */
  compact?: boolean;
  className?: string;
};

const SHEET_CLASSES =
  "flex flex-col gap-6 rounded-lg bg-sheet p-6 text-sheet-foreground sm:p-8";

const EYEBROW_CLASSES = "text-xs tracking-wide text-muted-foreground";

const DEFAULT_STEPS_GATE = "Available after 2 checks or from the tutor.";

function headerLine(header: QuestionSheetHeader) {
  return [
    header.topicLabel,
    header.positionLabel,
    header.questionCode,
    header.answerType,
    header.difficultyLabel,
  ]
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join(" · ");
}

function SheetHeaderLine({
  header,
  menu,
}: {
  header: QuestionSheetHeader;
  menu?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <p className="min-w-0 font-mono text-xs text-muted-foreground">
        {headerLine(header)}
      </p>
      {menu ? <div className="ml-auto shrink-0">{menu}</div> : null}
    </div>
  );
}

/**
 * THE SHEET. A worksheet on a desk: the lightest surface in the room, so it
 * needs no border and no shadow to separate itself from the page. Purely
 * presentational — every value and every callback comes from the caller, which
 * is what lets the same component be the hero on the landing page, the body of
 * `/practice`, and the professor's preview.
 */
export function QuestionSheet({
  header,
  prompt,
  answer,
  hints,
  steps,
  footer,
  menu,
  tombstone,
  compact = false,
  className,
}: QuestionSheetProps) {
  const tombstoned = tombstone !== undefined;

  if (compact) {
    return (
      <div
        data-slot="question-sheet"
        data-compact="true"
        className={cn(SHEET_CLASSES, "gap-3 p-4 sm:p-5", className)}
      >
        <SheetHeaderLine header={header} menu={menu} />
        {tombstoned ? (
          <p className="text-sm text-muted-foreground">
            Your professor retired this question.
          </p>
        ) : (
          <MathText className="line-clamp-2 font-display text-base leading-7">
            {prompt}
          </MathText>
        )}
      </div>
    );
  }

  return (
    <div data-slot="question-sheet" className={cn(SHEET_CLASSES, className)}>
      <SheetHeaderLine header={header} menu={menu} />

      {tombstoned ? (
        <div
          aria-live="polite"
          className="rounded-[6px] border border-destructive/40 bg-destructive/10 px-4 py-3"
        >
          <p className="text-sm font-medium">
            Your professor retired this question.
          </p>
          {tombstone.trim().length > 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">{tombstone}</p>
          ) : null}
        </div>
      ) : (
        <>
          <MathText className="font-display text-xl leading-8 text-sheet-foreground">
            {prompt}
          </MathText>

          {answer ? <AnswerBlock answer={answer} /> : null}

          <HintLadder hints={hints} />

          {steps ? <StepLadder steps={steps} /> : null}
        </>
      )}

      {footer ? <div className="pt-2">{footer}</div> : null}
    </div>
  );
}

function AnswerBlock({ answer }: { answer: QuestionSheetAnswer }) {
  const inputId = useId();
  const verdict = answer.verdict ?? null;
  const busy = Boolean(answer.disabled || answer.checking);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    if (!busy) {
      answer.onCheck();
    }
  };

  const helper = [
    answer.helper,
    answer.attemptsLeft !== undefined
      ? `${answer.attemptsLeft} attempt${answer.attemptsLeft === 1 ? "" : "s"} left`
      : undefined,
  ]
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join(" · ");

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium" htmlFor={inputId}>
        Your answer
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          id={inputId}
          value={answer.value}
          onChange={(event) => answer.onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={answer.disabled}
          placeholder={answer.placeholder}
          autoComplete="off"
          // The wash is the whole feedback animation: 200ms of colour behind
          // the value the student typed, no modal and no banner.
          className={cn(
            "h-11 min-w-0 flex-1 rounded-[6px] font-mono transition-colors duration-200",
            verdict === "correct" && "border-success bg-green-100",
            verdict === "incorrect" && "border-destructive bg-destructive/10",
          )}
          aria-invalid={verdict === "incorrect" ? true : undefined}
        />
        <Button
          type="button"
          variant="cta"
          onClick={answer.onCheck}
          disabled={busy}
          className="h-11 rounded-[6px]"
        >
          {answer.checking ? "Checking…" : "Check answer"}
        </Button>
      </div>
      {helper ? (
        <p className="text-xs text-muted-foreground">{helper}</p>
      ) : null}
    </div>
  );
}

function HintLadder({ hints }: { hints: QuestionSheetHints }) {
  const revealedCount = hints.revealed.length;
  const remaining = hints.total - revealedCount;

  if (hints.total <= 0 && !hints.gateText) {
    return null;
  }

  return (
    <section className="flex flex-col gap-2">
      <p className={EYEBROW_CLASSES}>HINTS</p>

      {hints.revealed.map((text, index) => (
        <div
          key={`hint-${index}`}
          className="flex gap-3 rounded-r-[6px] border-l-2 border-amber-500 bg-amber-100 px-4 py-3 animate-in fade-in slide-in-from-top-1 duration-150"
        >
          <span
            aria-hidden="true"
            className="shrink-0 font-mono text-xs text-muted-foreground"
          >
            {index + 1}
          </span>
          <MathText className="min-w-0 text-sm leading-6">{text}</MathText>
        </div>
      ))}

      {remaining > 0 ? (
        hints.onReveal ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={hints.onReveal}
            disabled={hints.revealing}
            className="w-fit px-2 text-muted-foreground hover:text-foreground"
          >
            <ChevronRight aria-hidden="true" />
            {`Reveal hint ${revealedCount + 1} of ${hints.total}`}
          </Button>
        ) : (
          <p className="flex items-center gap-1 px-2 text-sm text-muted-foreground">
            <ChevronRight aria-hidden="true" className="size-4" />
            {`Reveal hint ${revealedCount + 1} of ${hints.total}`}
          </p>
        )
      ) : null}

      {hints.gateText ? (
        <p className="text-xs text-muted-foreground">{hints.gateText}</p>
      ) : null}
    </section>
  );
}

function StepLadder({ steps }: { steps: QuestionSheetSteps }) {
  const hasSteps = steps.revealed.length > 0;

  return (
    <section className="flex flex-col gap-2">
      <p className={EYEBROW_CLASSES}>STEPS</p>

      {hasSteps ? (
        <ol className="flex flex-col gap-2">
          {steps.revealed.map((text, index) => (
            <li
              key={`step-${index}`}
              className="flex gap-3 border-l-2 border-indigo-300 px-4 py-2 animate-in fade-in slide-in-from-top-1 duration-150"
            >
              <span
                aria-hidden="true"
                className="shrink-0 font-mono text-xs text-muted-foreground"
              >
                {index + 1}
              </span>
              <MathText className="min-w-0 text-sm leading-6">{text}</MathText>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">
          {steps.gateText ?? DEFAULT_STEPS_GATE}
        </p>
      )}

      {hasSteps && steps.onReveal ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={steps.onReveal}
          className="w-fit px-2 text-muted-foreground hover:text-foreground"
        >
          <ChevronRight aria-hidden="true" />
          {steps.total
            ? `Reveal step ${steps.revealed.length + 1} of ${steps.total}`
            : "Reveal next step"}
        </Button>
      ) : null}
    </section>
  );
}

/**
 * The loading state everywhere the sheet appears. Three serif-height lines,
 * one input-height block, two ladder rows — the shape of the thing that is
 * about to arrive. Never a spinner.
 */
export function QuestionSheetSkeleton({ className }: { className?: string }) {
  return (
    <div
      data-slot="question-sheet-skeleton"
      aria-hidden="true"
      className={cn(SHEET_CLASSES, className)}
    >
      <Skeleton className="h-3 w-52" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-11/12" />
        <Skeleton className="h-6 w-2/3" />
      </div>
      <Skeleton className="h-11 w-full rounded-[6px]" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full rounded-r-[6px]" />
        <Skeleton className="h-10 w-5/6 rounded-r-[6px]" />
      </div>
    </div>
  );
}
