"use client";

import { ChevronRight, CircleCheck, CircleHelp, CircleX } from "lucide-react";
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
  /** "unreadable": the checker could not parse the answer (not an attempt). */
  verdict?: "correct" | "incorrect" | "unreadable" | null;
  /** One sentence under the verdict label ("Check the denominator."). */
  verdictMessage?: string;
  checking?: boolean;
  attemptsLeft?: number;
  /**
   * Render the inline Check answer button (default true). Pass false when the
   * page carries its own Check (the practice action strip); Enter in the field
   * still calls `onCheck`.
   */
  showCheck?: boolean;
  /**
   * How the entry reads, rendered under the field (a KaTeX line such as
   * "Reads as 1/4 = 0.25"). Omit it while the entry does not parse.
   */
  preview?: ReactNode;
};

export type QuestionSheetHints = {
  total: number;
  revealed: string[];
  onReveal?: () => void;
  revealing?: boolean;
  gateText?: string;
  /**
   * Render the "Reveal hint n of m" control under the ladder (default true).
   * Pass false when the page reveals hints from elsewhere; the ladder then
   * shows only the opened rungs and nothing before the first.
   */
  revealControl?: boolean;
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
  /**
   * The question's title, rendered as a real heading (serif). When omitted
   * the full sheet still gets a visually hidden heading ("Question Q-A638")
   * so the page outline has one; the compact row gets none.
   */
  title?: string;
  /** Heading element for the title; default 2. */
  headingLevel?: 1 | 2 | 3 | 4;
  className?: string;
};

const SHEET_CLASSES =
  "sheet-shadow sheet-margin relative flex flex-col gap-6 rounded-panel bg-sheet py-6 pr-5 pl-[calc(var(--sheet-gutter)+1rem)] text-sheet-foreground sm:py-8 sm:pr-8 sm:pl-[calc(var(--sheet-gutter)+1.5rem)]";

const DEFAULT_STEPS_GATE = "Available once every hint is shown.";

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
      <p className="min-w-0 pt-0.5 font-mono text-sm text-ink-muted">
        {headerLine(header)}
      </p>
      {menu ? <div className="-mt-1.5 ml-auto shrink-0">{menu}</div> : null}
    </div>
  );
}

/** A number in the ruled margin, aligned with the first line of its row. */
function GutterNumber({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute top-3 right-full mr-4 w-(--sheet-gutter) text-center font-mono text-sm tabular sm:mr-6",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * THE SHEET. A worksheet on a desk: paper-white, the only surface with a
 * shadow (light theme), a ruled left margin whose gutter carries the hint and
 * step numbers, a serif problem statement, a mono answer line that washes
 * green or red, and a labelled verdict band.
 *
 * Purely presentational: every value and callback comes from the caller,
 * which is what lets the same component be the landing hero, the body of
 * `/practice`, a topic row, and the professor's preview.
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
  title,
  headingLevel = 2,
  className,
}: QuestionSheetProps) {
  const tombstoned = tombstone !== undefined;
  const headingId = useId();
  const Heading = `h${headingLevel}` as "h1" | "h2" | "h3" | "h4";

  if (compact) {
    return (
      <div
        data-slot="question-sheet"
        data-compact="true"
        className={cn(
          "flex flex-col gap-2 rounded-panel bg-sheet p-4 text-sheet-foreground sm:p-5",
          className,
        )}
      >
        <SheetHeaderLine header={header} menu={menu} />
        {title ? (
          <Heading className="type-h3 text-ink">{title}</Heading>
        ) : null}
        {tombstoned ? (
          <p className="type-small text-ink-muted">
            Your professor retired this question.
          </p>
        ) : (
          <MathText className="line-clamp-2 font-display text-base leading-relaxed text-ink">
            {prompt}
          </MathText>
        )}
      </div>
    );
  }

  return (
    <article
      data-slot="question-sheet"
      aria-labelledby={headingId}
      className={cn(SHEET_CLASSES, className)}
    >
      <div className="flex flex-col gap-2">
        <SheetHeaderLine header={header} menu={menu} />
        <Heading
          id={headingId}
          className={title ? "type-h2 text-ink" : "sr-only"}
        >
          {title ?? `Question ${header.questionCode}`}
        </Heading>
      </div>

      {tombstoned ? (
        <div
          aria-live="polite"
          className="rounded-r-control border-l-2 border-red-500 bg-red-100 px-4 py-3"
        >
          <p className="font-medium text-red-700">
            Your professor retired this question.
          </p>
          {tombstone.trim().length > 0 ? (
            <p className="type-small mt-1 text-ink">{tombstone}</p>
          ) : null}
        </div>
      ) : (
        <>
          <MathText className="type-reading text-ink">{prompt}</MathText>

          {answer ? <AnswerBlock answer={answer} /> : null}

          <HintLadder hints={hints} />

          {steps ? <StepLadder steps={steps} /> : null}
        </>
      )}

      {footer ? <div className="border-t border-rule pt-4">{footer}</div> : null}
    </article>
  );
}

const VERDICTS = {
  correct: {
    label: "Correct",
    Icon: CircleCheck,
    band: "bg-green-100 text-green-700",
    input: "border-green-500 bg-green-100",
  },
  incorrect: {
    label: "Not quite",
    Icon: CircleX,
    band: "bg-red-100 text-red-700",
    input: "border-red-500 bg-red-100",
  },
  unreadable: {
    label: "Couldn't read that answer",
    Icon: CircleHelp,
    band: "bg-surface-tint text-ink",
    input: "",
  },
} as const;

function AnswerBlock({ answer }: { answer: QuestionSheetAnswer }) {
  const inputId = useId();
  const helperId = useId();
  const previewId = useId();
  const verdictId = useId();
  const showCheck = answer.showCheck ?? true;
  const verdict = answer.verdict ?? null;
  const spec = verdict ? VERDICTS[verdict] : null;
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
      <label className="type-body-strong text-ink" htmlFor={inputId}>
        Your answer
      </label>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          id={inputId}
          mono
          value={answer.value}
          onChange={(event) => answer.onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={answer.disabled}
          placeholder={answer.placeholder}
          autoComplete="off"
          autoCapitalize="off"
          aria-describedby={
            [
              answer.preview ? previewId : null,
              helper ? helperId : null,
              spec ? verdictId : null,
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
          // The wash is the whole feedback animation: colour behind the value
          // the student typed, no modal and no banner.
          className={cn(
            "h-12 min-w-0 flex-1 transition-[background-color,border-color] duration-base pointer-coarse:h-12",
            spec?.input,
          )}
          aria-invalid={verdict === "incorrect" ? true : undefined}
        />
        {showCheck ? (
          <Button
            type="button"
            variant="cta"
            size="lg"
            onClick={answer.onCheck}
            disabled={busy}
            className="w-full sm:w-auto"
          >
            {answer.checking ? "Checking…" : "Check answer"}
          </Button>
        ) : null}
      </div>
      {answer.preview ? (
        <div id={previewId} className="type-small text-ink-muted">
          {answer.preview}
        </div>
      ) : null}
      {helper ? (
        <p id={helperId} className="type-small text-ink-muted">
          {helper}
        </p>
      ) : null}
      <div role="status" aria-live="polite" id={verdictId}>
        {spec ? (
          <div
            data-slot="verdict-band"
            data-verdict={verdict}
            className={cn(
              "flex items-start gap-2.5 rounded-control px-4 py-3 animate-in fade-in-0 duration-base",
              spec.band,
            )}
          >
            <spec.Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            <div className="flex flex-col gap-0.5">
              <p className="font-medium">{spec.label}</p>
              {answer.verdictMessage ? (
                <p className="type-small text-ink">{answer.verdictMessage}</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function HintLadder({ hints }: { hints: QuestionSheetHints }) {
  const revealedCount = hints.revealed.length;
  const remaining = hints.total - revealedCount;
  const revealControl = hints.revealControl ?? true;

  if (hints.total <= 0 && !hints.gateText) {
    return null;
  }
  if (!revealControl && revealedCount === 0 && !hints.gateText) {
    return null;
  }

  return (
    <section aria-label="Hints" className="flex flex-col gap-2">
      <p className="type-label">Hints</p>

      {hints.revealed.length > 0 ? (
        <ol className="flex flex-col gap-2">
          {hints.revealed.map((text, index) => (
            <li
              key={`hint-${index}`}
              className="relative rounded-r-control border-l-2 border-amber-500 bg-amber-100 px-4 py-3 text-ink animate-in fade-in-0 slide-in-from-top-1 duration-base"
            >
              <GutterNumber className="text-amber-700">{index + 1}</GutterNumber>
              <span className="sr-only">{`Hint ${index + 1}: `}</span>
              <MathText className="min-w-0 type-reading">{text}</MathText>
            </li>
          ))}
        </ol>
      ) : null}

      {revealControl && remaining > 0 ? (
        hints.onReveal ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={hints.onReveal}
            loading={hints.revealing}
            className="w-fit px-2 text-ink-muted hover:text-ink"
          >
            <ChevronRight aria-hidden="true" />
            {`Reveal hint ${revealedCount + 1} of ${hints.total}`}
          </Button>
        ) : (
          <p className="flex items-center gap-1 px-2 text-sm text-ink-muted">
            <ChevronRight aria-hidden="true" className="size-4" />
            {`Reveal hint ${revealedCount + 1} of ${hints.total}`}
          </p>
        )
      ) : null}

      {hints.gateText ? (
        <p className="type-caption">{hints.gateText}</p>
      ) : null}
    </section>
  );
}

function StepLadder({ steps }: { steps: QuestionSheetSteps }) {
  const hasSteps = steps.revealed.length > 0;

  return (
    <section aria-label="Steps" className="flex flex-col gap-2">
      <p className="type-label">Steps</p>

      {hasSteps ? (
        <ol className="flex flex-col gap-2">
          {steps.revealed.map((text, index) => (
            <li
              key={`step-${index}`}
              className="relative rounded-r-control border-l-2 border-azure-500 bg-azure-100 px-4 py-3 text-ink animate-in fade-in-0 slide-in-from-top-1 duration-base"
            >
              <GutterNumber className="text-azure-700">{index + 1}</GutterNumber>
              <span className="sr-only">{`Step ${index + 1}: `}</span>
              <MathText className="min-w-0 type-reading">{text}</MathText>
            </li>
          ))}
        </ol>
      ) : (
        <p className="type-small text-ink-muted">
          {steps.gateText ?? DEFAULT_STEPS_GATE}
        </p>
      )}

      {hasSteps && steps.onReveal ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={steps.onReveal}
          className="w-fit px-2 text-ink-muted hover:text-ink"
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
 * The loading state everywhere the sheet appears: the header line, three
 * reading-height lines, the answer line, two ladder rows. Never a spinner.
 */
export function QuestionSheetSkeleton({ className }: { className?: string }) {
  return (
    <div
      data-slot="question-sheet-skeleton"
      aria-hidden="true"
      className={cn(SHEET_CLASSES, className)}
    >
      <Skeleton className="h-4 w-52" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-11/12" />
        <Skeleton className="h-6 w-2/3" />
      </div>
      <Skeleton className="h-12 w-full" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-12 w-full rounded-l-none" />
        <Skeleton className="h-12 w-5/6 rounded-l-none" />
      </div>
    </div>
  );
}
