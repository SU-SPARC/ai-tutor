"use client";

import {
  ArrowRight,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  CircleX,
  Keyboard,
  ListOrdered,
  Lock,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";

import {
  MathAnswerField,
  PlainAnswerField,
  type MathAnswerFieldHandle,
} from "@/components/math/math-answer-field";
import {
  MathKeypad,
  MathKeypadDock,
  useKeypadLayout,
  useKeypadOpen,
} from "@/components/math/math-keypad";
import { MathText } from "@/components/math/math-renderer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { evaluateEntry, type AnswerEntry } from "@/lib/math/answer-notation";
import { cn } from "@/lib/utils";

export type SheetHint = {
  index: number;
  /** `undefined` means "not revealed yet". */
  text?: string;
};

export type QuestionSheetHeader = {
  topicLabel: string;
  positionLabel?: string;
  /**
   * The question code ("Q-A638"). Staff previews show it; student surfaces
   * leave it out (the report form carries it instead).
   */
  questionCode?: string;
  /** The answer-type word ("numeric"); left out on student surfaces. */
  answerType?: string;
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
  /**
   * The next move, rendered inside the verdict band beside its sentence
   * (practice: "Show hint 2 of 3" after a wrong answer). The band is
   * focusable (`tabIndex=-1`) so a page can move focus to it after a check.
   */
  verdictAction?: ReactNode;
  checking?: boolean;
  attemptsLeft?: number;
  /**
   * Render the inline Check answer button (default true). Pass false when the
   * page carries its own Check (the practice action strip); Enter in the field
   * still calls `onCheck`, and the keypad drops its own Check key so there is
   * only one Check on screen.
   */
  showCheck?: boolean;
  /**
   * How the entry reads, rendered under the field (a KaTeX line such as
   * "Reads as 1/4 = 0.25"). Omit it while the entry does not parse. A
   * function receives what the math field made of the entry (its notation,
   * and the value that is checked when it evaluated an expression).
   */
  preview?: ReactNode | ((entry: AnswerEntry) => ReactNode);
  /**
   * "math": the math field (MathLive once it loads, so fractions and powers
   * draw in the field) with the on-screen keypad. "text" (default): the
   * plain mono input, for word answers and number lists.
   */
  notation?: "math" | "text";
  /** Highlight the keypad key the question asks for. */
  emphasizeKey?: "percent";
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
  /**
   * Render nothing until a step is revealed (default false). The hint row's
   * Steps pip ("Steps unlock after hint 3" → "Steps ready") already says
   * where the steps stand, so a page that reveals them from elsewhere can
   * drop the gate sentence.
   */
  hideUntilRevealed?: boolean;
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
        {title ? <Heading className="type-h3 text-ink">{title}</Heading> : null}
        {tombstoned ? (
          <p className="type-small flex flex-wrap items-center gap-2 text-ink-muted">
            <span className="chip-text rounded-chip bg-surface-tint px-2 py-0.5 text-ink">
              No longer available
            </span>
            Removed by your professor · your answers are kept
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
          {title ??
            (header.questionCode
              ? `Question ${header.questionCode}`
              : "Question")}
        </Heading>
      </div>

      {tombstoned ? (
        <div
          aria-live="polite"
          data-slot="question-tombstone"
          className="rounded-r-control border-l-2 border-rule bg-surface-tint px-4 py-3"
        >
          <p className="font-medium text-ink">
            Your professor removed this question. Your earlier work is saved.
          </p>
          {tombstone.trim().length > 0 ? (
            <p className="type-small mt-1 text-ink">{tombstone}</p>
          ) : null}
        </div>
      ) : (
        <>
          <MathText className="type-reading text-ink">{prompt}</MathText>

          {answer ? <AnswerBlock answer={answer} /> : null}

          <HintLadder
            hints={hints}
            steps={
              steps
                ? {
                    shown: steps.revealed.length > 0,
                  }
                : undefined
            }
          />

          {steps ? <StepLadder steps={steps} /> : null}
        </>
      )}

      {footer ? (
        <div className="border-t border-rule pt-4">{footer}</div>
      ) : null}
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
  const keypadId = useId();
  const showCheck = answer.showCheck ?? true;
  const verdict = answer.verdict ?? null;
  const spec = verdict ? VERDICTS[verdict] : null;
  const busy = Boolean(answer.disabled || answer.checking);
  const math = answer.notation === "math";

  const layout = useKeypadLayout();
  const [keypadOpen, setKeypadOpen] = useKeypadOpen();
  // The field or the docked keypad holds focus (phones and tablets).
  const [focused, setFocused] = useState(false);
  const [reported, setReported] = useState<AnswerEntry | null>(null);
  const [dockHeight, setDockHeight] = useState(0);
  const fieldRef = useRef<MathAnswerFieldHandle>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const docked = math && layout === "docked" && focused;

  // What the field made of the entry. A value the field did not emit (a
  // restore, a cleared field) is read here from the plain string.
  const entry =
    reported && reported.sent === answer.value
      ? reported
      : evaluateEntry(answer.value);
  const preview =
    typeof answer.preview === "function"
      ? answer.preview(entry)
      : answer.preview;

  const submit = () => {
    if (!busy) {
      answer.onCheck();
    }
  };

  // Leaving the field for a key of the docked pad keeps the pad up.
  const stillInside = () => {
    const active = document.activeElement;
    return Boolean(
      active &&
      (active === fieldRef.current?.element() ||
        dockRef.current?.contains(active)),
    );
  };
  const handleFocusChange = (next: boolean) => {
    if (next) {
      setFocused(true);
      return;
    }
    window.setTimeout(() => {
      if (!stillInside()) setFocused(false);
    }, 0);
  };
  const handleDockBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null))
      return;
    handleFocusChange(false);
  };
  const hideDock = () => {
    setFocused(false);
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  };

  // Keep the field in view above the docked pad.
  useEffect(() => {
    const dock = dockRef.current;
    if (!docked || !dock) return;
    const observer = new ResizeObserver(() => {
      setDockHeight(dock.getBoundingClientRect().height);
      const field = fieldRef.current?.element();
      if (!field) return;
      const overlap =
        field.getBoundingClientRect().bottom +
        24 -
        dock.getBoundingClientRect().top;
      if (overlap > 0) window.scrollBy({ top: overlap, behavior: "smooth" });
    });
    observer.observe(dock);
    return () => observer.disconnect();
  }, [docked]);

  const helper = [
    answer.helper,
    answer.attemptsLeft !== undefined
      ? `${answer.attemptsLeft} attempt${answer.attemptsLeft === 1 ? "" : "s"} left`
      : undefined,
  ]
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join(" · ");

  const fieldProps = {
    id: inputId,
    value: answer.value,
    onChange: answer.onChange,
    onEnter: submit,
    disabled: answer.disabled,
    placeholder: answer.placeholder,
    verdict,
    describedBy:
      [
        preview ? previewId : null,
        helper ? helperId : null,
        spec ? verdictId : null,
      ]
        .filter(Boolean)
        .join(" ") || undefined,
    // The wash is the whole feedback animation: colour behind the value
    // the student typed, no modal and no banner. (The math field takes the
    // same wash from `data-verdict`, in globals.css.)
    className: cn(
      "h-12 min-w-0 flex-1 transition-[background-color,border-color] duration-base pointer-coarse:h-12",
      spec?.input,
    ),
  };

  return (
    <div data-tour="practice-answer" className="flex flex-col gap-2">
      <label className="type-body-strong text-ink" htmlFor={inputId}>
        Your answer
      </label>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {math ? (
          <MathAnswerField
            {...fieldProps}
            ref={fieldRef}
            onEntry={setReported}
            onFocusChange={handleFocusChange}
            suppressSystemKeyboard={layout === "docked"}
          />
        ) : (
          <PlainAnswerField {...fieldProps} />
        )}
        {math ? (
          // Desktop with a mouse: the keypad is a helper, collapsed until
          // asked for. Phones and tablets dock it while the field is focused.
          <Button
            type="button"
            variant="outline"
            size="lg"
            aria-pressed={keypadOpen}
            aria-controls={keypadOpen ? keypadId : undefined}
            onClick={() => setKeypadOpen(!keypadOpen)}
            className="hidden px-4 lg:pointer-fine:inline-flex"
          >
            <Keyboard aria-hidden="true" className="size-5" />
            Keypad
          </Button>
        ) : null}
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
      {math && layout === "inline" && keypadOpen ? (
        <MathKeypad
          id={keypadId}
          layout="inline"
          onAction={(action) => fieldRef.current?.run(action)}
          checkDisabled={busy}
          emphasize={answer.emphasizeKey}
          showCheck={showCheck}
        />
      ) : null}
      {preview ? (
        <div id={previewId} className="type-small text-ink-muted">
          {preview}
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
            // Focus target after a check on touch screens: focusing the band
            // (not the field) keeps the docked keypad from covering it.
            tabIndex={-1}
            className={cn(
              "flex flex-wrap items-start gap-x-2.5 gap-y-2 rounded-control px-4 py-3 animate-in fade-in-0 duration-base focus-ring",
              spec.band,
            )}
          >
            <spec.Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="font-medium">{spec.label}</p>
              {answer.verdictMessage ? (
                <p className="type-small text-ink">{answer.verdictMessage}</p>
              ) : null}
            </div>
            {answer.verdictAction ? (
              <div className="flex shrink-0 items-center max-sm:basis-full max-sm:pl-7.5">
                {answer.verdictAction}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {docked ? (
        <>
          {/* Room to scroll the field clear of the docked pad. */}
          <div aria-hidden="true" style={{ height: dockHeight }} />
          <MathKeypadDock
            preview={preview}
            onHide={hideDock}
            dockRef={(element) => {
              dockRef.current = element;
            }}
          >
            <div onBlur={handleDockBlur}>
              <MathKeypad
                layout="docked"
                onAction={(action) => fieldRef.current?.run(action)}
                checkDisabled={busy}
                emphasize={answer.emphasizeKey}
                showCheck={showCheck}
              />
            </div>
          </MathKeypadDock>
        </>
      ) : null}
    </div>
  );
}

/** "Steps unlock after hint 3" → "Steps ready": the steps pip's words. */
export function stepsPipLabel(hintsOpen: number, hintTotal: number) {
  return hintsOpen >= hintTotal
    ? "Steps ready"
    : `Steps unlock after hint ${hintTotal}`;
}

/**
 * `Hints ○ ○ ○ → Steps 🔒`: the hint-before-steps order as a row of pips,
 * not a sentence. Amber rungs fill as hints open; the Steps pip names its
 * gate until the last hint is open, then reads "Steps ready".
 */
function HintSequence({
  total,
  open,
  steps,
}: {
  total: number;
  open: number;
  steps?: { shown: boolean };
}) {
  const ready = open >= total;
  const spoken = `${open} of ${total} hint${total === 1 ? "" : "s"} open.`;
  return (
    <div
      data-slot="hint-sequence"
      data-tour="practice-hints"
      className="flex flex-wrap items-center gap-x-2.5 gap-y-1"
    >
      <p className="type-label text-ink">Hints</p>
      <ol aria-label={spoken} className="flex items-center gap-1.5">
        {Array.from({ length: total }, (_, index) => {
          const filled = index < open;
          return (
            <li
              key={`pip-${index}`}
              data-state={filled ? "open" : "closed"}
              className={cn(
                "size-3 rounded-full border-2 transition-colors duration-base",
                filled
                  ? "border-amber-500 bg-amber-500"
                  : "border-amber-500/60 bg-transparent",
              )}
            >
              <span className="sr-only">{`Hint ${index + 1}${filled ? " open" : ""}`}</span>
            </li>
          );
        })}
      </ol>
      {steps ? (
        <>
          <ArrowRight aria-hidden="true" className="size-4 text-ink-muted" />
          <p
            data-slot="steps-pip"
            data-state={ready ? "ready" : "locked"}
            className={cn(
              "type-caption inline-flex items-center gap-1.5",
              ready ? "text-azure-700" : "text-ink-muted",
            )}
          >
            {ready ? (
              <ListOrdered aria-hidden="true" className="size-4" />
            ) : (
              <Lock aria-hidden="true" className="size-3.5" />
            )}
            {stepsPipLabel(open, total)}
          </p>
        </>
      ) : null}
    </div>
  );
}

function HintLadder({
  hints,
  steps,
}: {
  hints: QuestionSheetHints;
  steps?: { shown: boolean };
}) {
  const revealedCount = hints.revealed.length;
  const remaining = hints.total - revealedCount;
  const revealControl = hints.revealControl ?? true;

  if (hints.total <= 0 && !hints.gateText) {
    return null;
  }

  return (
    <section aria-label="Hints" className="flex flex-col gap-2">
      {hints.total > 0 ? (
        <HintSequence
          total={hints.total}
          open={Math.min(revealedCount, hints.total)}
          steps={steps}
        />
      ) : (
        <p className="type-label">Hints</p>
      )}

      {hints.revealed.length > 0 ? (
        <ol className="flex flex-col gap-2">
          {hints.revealed.map((text, index) => (
            <li
              key={`hint-${index}`}
              className="relative rounded-r-control border-l-2 border-amber-500 bg-amber-100 px-4 py-3 text-ink animate-in fade-in-0 slide-in-from-top-1 duration-base"
            >
              <GutterNumber className="text-amber-700">
                {index + 1}
              </GutterNumber>
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

      {hints.gateText ? <p className="type-caption">{hints.gateText}</p> : null}
    </section>
  );
}

function StepLadder({ steps }: { steps: QuestionSheetSteps }) {
  const hasSteps = steps.revealed.length > 0;

  if (!hasSteps && steps.hideUntilRevealed) {
    return null;
  }

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
              <GutterNumber className="text-azure-700">
                {index + 1}
              </GutterNumber>
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
