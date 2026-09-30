"use client";

import { useId, useState } from "react";

import { LANDING_COLUMN } from "@/components/landing/landing-headline";
import { LandingSheet } from "@/components/landing/landing-sheet";
import {
  LandingTutorPanel,
  TUTOR_INTRO_MESSAGE,
  WHERE_TO_START_MESSAGE,
} from "@/components/landing/landing-tutor-panel";
import {
  SyllabusRail,
  type SyllabusRailTopic,
} from "@/components/shell/app-rail";
import { useSheetSession } from "@/components/tutor/use-sheet-session";
import { cn } from "@/lib/utils";
import type { StudentPracticeQuestion } from "@/lib/types";

/**
 * The Sheet section's anchor. Nothing on the landing page links here any
 * more, but older links to `/#try-one-now` still land on the question.
 */
export const TRY_ONE_NOW_ID = "try-one-now";

export type LandingScreenProps = {
  question: StudentPracticeQuestion;
  /** The hero question's week, for the sheet header ("Wk 3"). */
  weekNumber: number;
  railTopics: SyllabusRailTopic[];
  /** "84 questions · 11 topics". */
  railFooter: string;
  /**
   * Signed out: the question is a preview. It can be read but not answered,
   * hinted or discussed with the tutor, and no guest session is created.
   */
  locked?: boolean;
};

/**
 * The product under the headline (live when signed in, a locked preview
 * when signed out): the practice screen's own three
 * columns (syllabus, the Sheet, the tutor) drawn as one framed window, with a
 * real question in the middle.
 *
 * The columns leave right to left exactly as they do in the app: the tutor
 * below 1280, the syllabus below 1024. On a phone the frame disappears and
 * the Sheet sits straight on the desk, second after the headline.
 *
 * The tutor session lives here rather than in the sheet because the tutor's
 * "Give me a hint" and the sheet's hint ladder are the *same* session — two
 * components reading one hook is what makes the hero behave like the app
 * instead of two widgets side by side.
 */
export function LandingScreen({
  question,
  weekNumber,
  railTopics,
  railFooter,
  locked = false,
}: LandingScreenProps) {
  const { check, error, hint, hintsRevealed, lastMessage, status, verdict } =
    useSheetSession({
      // Locked: the hook never talks to the server (sessions are created
      // lazily on the first check or hint, and neither is offered).
      enabled: !locked,
      hintCount: question.hintCount,
      questionId: question.id,
      topicId: question.topicId,
    });
  const [value, setValue] = useState("");
  const [askedWhereToStart, setAskedWhereToStart] = useState(false);
  const labelId = useId();

  const messages = [
    TUTOR_INTRO_MESSAGE,
    ...(askedWhereToStart ? [WHERE_TO_START_MESSAGE] : []),
    ...(lastMessage ? [lastMessage] : []),
  ];

  const busy = status === "checking" || status === "hinting";
  const sheetVerdict =
    verdict === "correct"
      ? ("correct" as const)
      : verdict === "incorrect"
        ? ("incorrect" as const)
        : null;

  return (
    <section
      id={TRY_ONE_NOW_ID}
      aria-labelledby={labelId}
      className={cn(LANDING_COLUMN, "scroll-mt-20 pb-12 lg:pb-20")}
    >
      {locked ? (
        <div className="mb-3 flex flex-col gap-1">
          <p id={labelId} className="type-label">
            A problem from your course
          </p>
          <p className="type-small text-ink-muted">
            Join with your section code to answer it.
          </p>
        </div>
      ) : (
        <p id={labelId} className="type-label mb-3">
          Try one now
        </p>
      )}

      <div
        data-slot="landing-frame"
        className={cn(
          "grid grid-cols-1",
          "lg:grid-cols-[var(--rail-w)_minmax(0,1fr)] lg:overflow-hidden lg:rounded-panel lg:border lg:border-rule",
          "xl:grid-cols-[var(--rail-w)_minmax(0,1fr)_var(--drawer-w)]",
        )}
      >
        <div className="hidden bg-surface-tint py-4 lg:block">
          <SyllabusRail
            topics={railTopics}
            footer={<p className="type-caption tabular">{railFooter}</p>}
          />
        </div>

        <div className="min-w-0 lg:bg-surface lg:p-8 xl:px-6">
          <div className="mx-auto w-full max-w-2xl">
            <LandingSheet
              question={question}
              weekNumber={weekNumber}
              value={value}
              onChange={setValue}
              onCheck={() => void check(value)}
              onRevealHint={() => void hint()}
              hintsRevealed={hintsRevealed}
              checking={status === "checking"}
              revealing={status === "hinting"}
              verdict={sheetVerdict}
              error={error}
              locked={locked}
            />
          </div>
        </div>

        <div className="hidden bg-surface-tint px-5 py-6 xl:block">
          <LandingTutorPanel
            messages={messages}
            onHint={() => void hint()}
            onWhereToStart={() => setAskedWhereToStart(true)}
            hintDisabled={busy || hintsRevealed.length >= question.hintCount}
            locked={locked}
          />
        </div>
      </div>
    </section>
  );
}
