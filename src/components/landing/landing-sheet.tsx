"use client";

import Link from "next/link";

import { LANDING_TEXT_LINK } from "@/components/landing/landing-headline";
import { QuestionSheet } from "@/components/sheet/question-sheet";
import type { SessionErrorState } from "@/components/tutor/tutor-client";
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
};

// The header's answer-type word is derived from the same format hint the
// student reads under the input, so the two can never disagree.
const NUMERIC_HINT = /decimal|fraction|percentage|number/i;

export function answerTypeFor(inputFormatHint: string) {
  return NUMERIC_HINT.test(inputFormatHint) ? "numeric" : "text";
}

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
}: LandingSheetProps) {
  return (
    <div className="flex flex-col gap-3">
      <QuestionSheet
        title={question.title}
        headingLevel={2}
        header={{
          topicLabel: `Wk ${weekNumber}`,
          questionCode: questionCode(question.id),
          answerType: answerTypeFor(question.inputFormatHint),
          difficultyLabel: studentDifficultyLabel(question.difficulty),
        }}
        prompt={question.prompt}
        answer={{
          value,
          onChange,
          onCheck,
          checking,
          helper: question.inputFormatHint,
          verdict,
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
