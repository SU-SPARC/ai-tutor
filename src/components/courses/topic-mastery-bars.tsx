"use client";

import { MasteryChip, type MasteryLevel } from "@/components/ui/mastery-chip";
import type { SectionMember, TopicId } from "@/lib/courses/types";

/** Score (0–100) at or above which a student counts as Proficient. */
const PROFICIENT_AT = 65;

/**
 * The design system's five named levels from a 0–100 topic score. The name is
 * always printed (MasteryChip), never a bare percentage.
 */
export function masteryLevelFromScore(score: number | null): MasteryLevel {
  if (score === null || score <= 0) {
    return 0;
  }
  if (score < 40) {
    return 1;
  }
  if (score < PROFICIENT_AT) {
    return 2;
  }
  if (score < 85) {
    return 3;
  }
  return 4;
}

export type TopicMasteryRow = {
  topicId: TopicId;
  label: string;
};

/**
 * One row per week students can see: the class's typical level as a named
 * chip, and "n of m students at Proficient or above" in words. A low level is
 * something to look at, not a grade, so nothing is coloured as a verdict.
 */
export function TopicMasteryBars({
  members,
  rows,
}: {
  members: SectionMember[];
  rows: TopicMasteryRow[];
}) {
  if (rows.length === 0) {
    return (
      <p className="type-body max-w-prose text-ink-muted">
        No week is open to this section yet, so there is nothing to measure.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-rule rounded-panel bg-sheet px-5">
      {rows.map((row) => {
        const scores = members
          .map((member) => member.topicMastery[row.topicId])
          .filter((score): score is number => typeof score === "number");
        const average =
          scores.length === 0
            ? null
            : Math.round(
                scores.reduce((sum, score) => sum + score, 0) / scores.length,
              );
        const proficient = scores.filter((score) => score >= PROFICIENT_AT)
          .length;
        return (
          <li
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3"
            key={row.topicId}
          >
            <span className="type-body min-w-0 text-ink">{row.label}</span>
            <span className="flex flex-wrap items-center gap-3">
              <MasteryChip level={masteryLevelFromScore(average)} />
              <span className="type-body text-ink">
                {scores.length === 0
                  ? "No student has tried it yet"
                  : `${proficient} of ${members.length} students at Proficient or above`}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
