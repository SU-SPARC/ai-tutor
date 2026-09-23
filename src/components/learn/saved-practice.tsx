"use client";

import Link from "next/link";

import type { SavedPracticeRow } from "@/components/learn/learn-model";
import { QuestionSheet } from "@/components/sheet/question-sheet";

/**
 * Zone 4. The saved-practice list as collapsed Sheets, with anything the
 * professor retired kept below under its own heading rather than deleted —
 * the attempts still happened.
 */
export function SavedPractice({
  active,
  retired,
}: {
  active: SavedPracticeRow[];
  retired: SavedPracticeRow[];
}) {
  if (active.length === 0 && retired.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No saved practice yet. Answer a question and it will be waiting here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {active.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {active.map((row) => (
            <li key={row.sessionId}>
              <SavedPracticeSheet row={row} />
            </li>
          ))}
        </ul>
      ) : null}

      {retired.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs tracking-wide text-muted-foreground uppercase">
            Retired
          </h3>
          <ul className="flex flex-col gap-2">
            {retired.map((row) => (
              <li key={row.sessionId}>
                <SavedPracticeSheet row={row} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function SavedPracticeSheet({ row }: { row: SavedPracticeRow }) {
  const retired = row.status === "unavailable";

  return (
    <div className="flex flex-col gap-1">
      <QuestionSheet
        compact
        header={{
          topicLabel: row.isExtraPractice
            ? `${row.topicLabel} · extra practice`
            : row.topicLabel,
          questionCode: row.questionCode,
          answerType: retired
            ? "retired"
            : row.status === "completed"
              ? "completed"
              : "in progress",
          difficultyLabel:
            row.hintsUsed > 0
              ? `${row.hintsUsed} hint${row.hintsUsed === 1 ? "" : "s"} used`
              : undefined,
        }}
        hints={{ total: 0, revealed: [] }}
        prompt={row.prompt}
        tombstone={retired ? "Your attempts are kept." : undefined}
        menu={
          row.href ? (
            <Link
              href={row.href}
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              {row.status === "completed" ? "Review" : "Resume"}
            </Link>
          ) : undefined
        }
      />
    </div>
  );
}
