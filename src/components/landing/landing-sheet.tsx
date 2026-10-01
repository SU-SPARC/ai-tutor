"use client";

import Link from "next/link";

import {
  LANDING_SECTION_CODE_ID,
  LANDING_TEXT_LINK,
} from "@/components/landing/landing-headline";
import { AnswerReading } from "@/components/math/math-answer-field";
import { QuestionSheet } from "@/components/sheet/question-sheet";
import { Button } from "@/components/ui/button";
import {
  parsedAnswerPreview,
  type SessionErrorState,
} from "@/components/tutor/tutor-client";
import {
  answerNotationFromHint,
  answerTypeFromHint,
  formatHintAsksForPercent,
} from "@/lib/math/answer-notation";
import { questionCode, studentDifficultyLabel } from "@/lib/labels";
import type { StudentPracticeQuestion } from "@/lib/types";

export type LandingSheetProps = {
  question: StudentPracticeQuestion;
  weekNumber: number;
  value: string;
  onChange: (value: string) => void;
  onCheck: () => void;
  onRevealHint: () => void;
  hintsRevealed: string[];
  checking: boolean;
  revealing: boolean;
  verdict: "correct" | "incorrect" | null;
  error?: SessionErrorState | null;
  /**
   * Signed out: the question is shown but cannot be answered. The field is
   * disabled, there is no Check, keypad, preview, hint control or steps, and
   * [Join to answer] takes the visitor to the hero's section-code field.
   */
  locked?: boolean;
};

export const LOCKED_ANSWER_PLACEHOLDER = "Join your course to answer";
export const LOCKED_HINTS_TEXT = "Sign in or join your course to open hints.";

/**
 * [Join to answer]: scroll the hero's section-code form into view (smoothly,
 * unless the visitor prefers reduced motion) and put the cursor in its code
 * field. A no-op if the form is not on the page.
 */
export function focusSectionCodeForm() {
  const target = document.getElementById(LANDING_SECTION_CODE_ID);
  if (!target) {
    return;
  }
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  target.scrollIntoView({
    behavior: reduceMotion ? "auto" : "smooth",
    block: "center",
  });
  const field =
    target.querySelector<HTMLInputElement>('input[name="sectionCode"]') ??
    target.querySelector<HTMLInputElement>('input:not([type="hidden"])');
  // preventScroll: the scroll above is already on its way.
  field?.focus({ preventScroll: true });
}

const noop = () => {};

// The header's answer-type word is derived from the same format hint the
// student reads under the input, so the two can never disagree. One helper
// for the hero and /practice.
export const answerTypeFor = answerTypeFromHint;

/**
 * The landing hero: a real approved question, checked by the real rule-based
 * checker, with no account. Everything it knows comes from the session hook
 * that `LandingScreen` owns, because the tutor panel next to it drives the
 * same session.
 */
export function LandingSheet({
  question,
  weekNumber,
  value,
  onChange,
  onCheck,
  onRevealHint,
  hintsRevealed,
  checking,
  revealing,
  verdict,
  error,
  locked = false,
}: LandingSheetProps) {
  const header = {
    topicLabel: `Wk ${weekNumber}`,
    questionCode: questionCode(question.id),
    answerType: answerTypeFor(question.inputFormatHint),
    difficultyLabel: studentDifficultyLabel(question.difficulty),
  };

  if (locked) {
    // Preview: the same header, title and statement as the live Sheet, and
    // nothing that could start a session (no check, no hint, no steps).
    return (
      <QuestionSheet
        title={question.title}
        headingLevel={2}
        header={header}
        prompt={question.prompt}
        answer={{
          value: "",
          onChange: noop,
          onCheck: noop,
          disabled: true,
          placeholder: LOCKED_ANSWER_PLACEHOLDER,
          showCheck: false,
          helper: question.inputFormatHint,
          notation: "text",
        }}
        hints={{
          total: question.hintCount,
          revealed: [],
          revealControl: false,
          gateText: LOCKED_HINTS_TEXT,
        }}
        footer={
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={focusSectionCodeForm}
            className="w-full sm:w-auto"
          >
            Join to answer
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <QuestionSheet
        title={question.title}
        headingLevel={2}
        header={header}
        prompt={question.prompt}
        figure={question.figure}
        answer={{
          value,
          onChange,
          onCheck,
          checking,
          helper: question.inputFormatHint,
          verdict,
          notation: answerNotationFromHint(question.inputFormatHint),
          emphasizeKey: formatHintAsksForPercent(question.inputFormatHint)
            ? "percent"
            : undefined,
          // How the entry reads, and what is checked when the field
          // evaluated an expression.
          preview: (entry) => {
            if (answerTypeFor(question.inputFormatHint) !== "numeric") {
              return undefined;
            }
            const reading = parsedAnswerPreview(value, entry);
            return reading ? <AnswerReading preview={reading} /> : undefined;
          },
        }}
        hints={{
          total: question.hintCount,
          revealed: hintsRevealed,
          onReveal: onRevealHint,
          revealing,
        }}
        steps={{
          revealed: [],
          gateText: "Available once every hint is shown.",
        }}
      />

      {/* One polite region for what happens after a check: the invitation
       * to keep progress, or why the check could not run. It is always in
       * the DOM so screen readers pick up its changes. */}
      <div role="status" className="px-1">
        {verdict === "correct" ? (
          <p className="type-small text-ink-muted">
            That was the course’s own answer checker.{" "}
            <Link href="/join" className={LANDING_TEXT_LINK}>
              Join MATH-255 to keep your progress.
            </Link>
          </p>
        ) : null}

        {error ? (
          <p className="type-small text-ink">
            {error.message}
            {error.signInHref ? (
              <>
                {" "}
                <Link href={error.signInHref} className={LANDING_TEXT_LINK}>
                  Sign in
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}
