"use client";

import { useState } from "react";

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
import { ThreeColumn } from "@/components/shell/three-column";
import { useSheetSession } from "@/components/tutor/use-sheet-session";
import type { StudentPracticeQuestion } from "@/lib/types";

export type LandingScreenProps = {
  question: StudentPracticeQuestion;
  /** The hero question's week, for the sheet header ("Wk 3"). */
  weekNumber: number;
  railTopics: SyllabusRailTopic[];
  /** "84 questions · 11 topics". */
  railFooter: string;
};

/**
 * The landing page's product frame: the same three columns the practice screen
 * uses, with a real question in the middle.
 *
 * The tutor session lives here rather than in the sheet because the drawer's
 * "Give me a hint" chip and the sheet's hint ladder are the *same* session —
 * two components reading one hook is what makes the hero feel like the app
 * instead of two widgets side by side.
 */
export function LandingScreen({
  question,
  weekNumber,
  railTopics,
  railFooter,
}: LandingScreenProps) {
  const { check, error, hint, hintsRevealed, lastMessage, status, verdict } =
    useSheetSession({
      hintCount: question.hintCount,
      questionId: question.id,
      topicId: question.topicId,
    });
  const [value, setValue] = useState("");
  const [askedWhereToStart, setAskedWhereToStart] = useState(false);

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
    <ThreeColumn
      rail={
        <SyllabusRail
          topics={railTopics}
          footer={
            <p className="font-mono text-xs text-muted-foreground">
              {railFooter}
            </p>
          }
        />
      }
      drawer={
        <LandingTutorPanel
          messages={messages}
          onHint={() => void hint()}
          onWhereToStart={() => setAskedWhereToStart(true)}
          hintDisabled={busy || hintsRevealed.length >= question.hintCount}
        />
      }
    >
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
      />
    </ThreeColumn>
  );
}
