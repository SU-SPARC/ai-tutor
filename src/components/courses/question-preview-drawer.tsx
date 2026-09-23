"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

import { useOptionalCoursesStore } from "@/components/courses/courses-store";
import {
  PublishedNote,
  QuestionAction,
  QuestionStateBadge,
} from "@/components/courses/topic-question-table";
import { QuestionSheet } from "@/components/sheet/question-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { QuestionReleaseCourseGroup } from "@/lib/courses/selectors";
import type { BankQuestion, Difficulty } from "@/lib/courses/types";
import { questionCode } from "@/lib/labels";

/**
 * The course bank grades questions "foundational / core / challenge" while the
 * tutor's own records use "foundational / intermediate / challenge", so the
 * shared `studentDifficultyLabel` cannot be reused here. Three lines is
 * cheaper than making the two enums agree for a preview header.
 */
const STUDENT_DIFFICULTY: Record<Difficulty, string> = {
  foundational: "Intro",
  core: "Core",
  challenge: "Stretch",
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </h3>
      {children}
    </div>
  );
}

function statusText(
  status: QuestionReleaseCourseGroup["sections"][number]["status"],
  releasedVersion: number | null,
) {
  switch (status) {
    case "live":
      return { text: `v${releasedVersion} · live`, tone: "text-success" };
    case "older":
      return {
        text: `v${releasedVersion} · older version`,
        tone: "text-warning",
      };
    case "held":
      return {
        text: "held — version unpublished",
        tone: "text-muted-foreground",
      };
    default:
      return { text: "not released", tone: "text-muted-foreground" };
  }
}

/**
 * The Teachable-style read-only summary: the question exactly as a student
 * meets it, then the teaching notes that never reach one. Showing the real
 * sheet rather than a list of fields is the point — a question can be vetted
 * in the shape it will be answered in, without leaving the list.
 *
 * It is a panel rather than a modal — the table stays readable beside it.
 */
export function QuestionPreviewDrawer({
  question,
  topicId,
  courseGroup,
  publishedNote,
  onClose,
  onPublish,
  onPreview,
}: {
  question: BankQuestion;
  topicId: string;
  /** This course's sections only, from `questionReleaseMap`. */
  courseGroup: QuestionReleaseCourseGroup | undefined;
  publishedNote?: number;
  onClose: () => void;
  onPublish: (questionId: string) => void;
  onPreview: (questionId: string) => void;
}) {
  const store = useOptionalCoursesStore();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const releasedRows = (courseGroup?.sections ?? []).filter(
    (row) => row.status !== "not_released",
  );

  const weekNumber = store?.state.topics.find(
    (topic) => topic.id === question.topicId,
  )?.weekNumber;

  return (
    <aside
      aria-label={`Preview: ${question.title}`}
      className="fixed top-16 right-0 bottom-0 z-40 flex w-full max-w-md flex-col border-l border-border bg-card shadow-lg"
      role="dialog"
    >
      <header className="flex items-start justify-between gap-3 border-b border-border p-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-lg leading-6 font-semibold">{question.title}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <QuestionStateBadge state={question.state} />
            <Badge variant="secondary">{question.answerType}</Badge>
            <Badge variant="outline">{question.difficulty}</Badge>
          </div>
        </div>
        <Button
          aria-label="Close preview"
          onClick={onClose}
          size="icon"
          variant="ghost"
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex flex-col gap-5 text-sm leading-6">
          {/* Everything a student would see, revealed: the hints and steps are
              a ladder they climb one rung at a time, and a professor vetting
              the question needs the whole ladder at once. */}
          <QuestionSheet
            answer={{
              value: question.finalAnswer,
              onChange: () => {},
              onCheck: () => {},
              disabled: true,
              helper: "Correct answer (professor view)",
            }}
            header={{
              topicLabel: weekNumber ? `Wk ${weekNumber}` : "",
              questionCode: questionCode(question.id),
              answerType: question.answerType,
              difficultyLabel: STUDENT_DIFFICULTY[question.difficulty],
            }}
            hints={{
              total: question.hints.length,
              revealed: question.hints,
            }}
            prompt={question.prompt}
            steps={{ revealed: question.solutionSteps }}
          />

          {question.misconceptions.length > 0 ? (
            <Field label="Misconceptions">
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {question.misconceptions.map((entry, index) => (
                  <li key={`${index}-${entry.slice(0, 16)}`}>{entry}</li>
                ))}
              </ul>
            </Field>
          ) : null}

          <Separator />

          <Field label="Versions">
            <p className="text-muted-foreground">
              {question.publishedVersion === null
                ? "not published"
                : `v${question.publishedVersion} published`}{" "}
              · v{question.latestVersion} latest
            </p>
          </Field>

          <Field label="Released to">
            {releasedRows.length === 0 ? (
              <p className="text-muted-foreground">
                Not released to any section of this course.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {releasedRows.map((row) => {
                  const { text, tone } = statusText(
                    row.status,
                    row.releasedVersion,
                  );
                  return (
                    <li
                      className="flex items-center justify-between gap-3"
                      key={row.sectionId}
                    >
                      <span>{row.label}</span>
                      <span className={tone}>{text}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Field>
        </div>
      </div>

      <footer className="border-t border-border p-6">
        <QuestionAction
          onPreview={onPreview}
          onPublish={onPublish}
          question={question}
          topicId={topicId}
        />
        {publishedNote !== undefined ? (
          <PublishedNote version={publishedNote} />
        ) : null}
      </footer>
    </aside>
  );
}
