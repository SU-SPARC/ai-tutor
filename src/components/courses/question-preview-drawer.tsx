"use client";

import { useOptionalCoursesStore } from "@/components/courses/courses-store";
import {
  QuestionStateChip,
  ReleaseStatusChip,
} from "@/components/courses/course-status";
import {
  ANSWER_TYPE_LABELS,
  PublishedNote,
  QuestionAction,
  hasLegacyEditor,
} from "@/components/courses/topic-question-table";
import { QuestionSheet } from "@/components/sheet/question-sheet";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { QuestionReleaseCourseGroup } from "@/lib/courses/selectors";
import { DIFFICULTY_LABELS as STUDENT_DIFFICULTY } from "@/components/courses/bank-question-row";
import { sectionLabelText } from "@/components/courses/course-status";
import type { BankQuestion } from "@/lib/courses/types";
import { questionCode } from "@/lib/labels";

/**
 * The read-only preview: the question exactly as a student meets it (the real
 * Sheet, with the whole hint and step ladder revealed), then the teaching notes
 * that never reach one. A right-side Dialog: focus moves in, Escape and the
 * scrim close it, the page behind is inert, and focus returns to the row.
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

  const sections = courseGroup?.sections ?? [];
  const released = sections.filter((row) => row.status !== "not_released");

  // The footer carries the question's next move. "Preview" (published, no
  // editor) and drafts have none here, so the footer only shows a result.
  const hasAction =
    question.state === "approved" ||
    question.state === "unpublished" ||
    question.state === "needs_review" ||
    (question.state === "published" && hasLegacyEditor(question.id));

  const weekNumber = store?.state.topics.find(
    (topic) => topic.id === question.topicId,
  )?.weekNumber;

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open
    >
      <DialogContent side="right" width="lg">
        <DialogHeader className="border-b border-rule">
          <DialogTitle>{question.title}</DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-2">
              <QuestionStateChip state={question.state} />
              <span className="type-small text-ink-muted">
                {ANSWER_TYPE_LABELS[question.answerType] ?? question.answerType}{" "}
                · {STUDENT_DIFFICULTY[question.difficulty]}
              </span>
            </div>
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-6 pt-6">
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
              topicLabel: weekNumber ? `Week ${weekNumber}` : "",
              questionCode: questionCode(question.id),
              answerType:
                ANSWER_TYPE_LABELS[question.answerType] ?? question.answerType,
              difficultyLabel: STUDENT_DIFFICULTY[question.difficulty],
            }}
            headingLevel={3}
            hints={{
              total: question.hints.length,
              revealed: question.hints,
            }}
            prompt={question.prompt}
            steps={{ revealed: question.solutionSteps }}
          />

          {question.misconceptions.length > 0 ? (
            <section aria-labelledby="preview-misconceptions" className="flex flex-col gap-2">
              <h3 className="type-body-strong text-ink" id="preview-misconceptions">
                Common mistakes (only you see these)
              </h3>
              <ul className="type-small flex max-w-prose list-disc flex-col gap-1 pl-5 text-ink">
                {question.misconceptions.map((entry, index) => (
                  <li key={`${index}-${entry.slice(0, 16)}`}>{entry}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="preview-released" className="flex flex-col gap-2">
            <h3 className="type-body-strong text-ink" id="preview-released">
              Shown to
            </h3>
            {released.length === 0 ? (
              <p className="type-body text-ink-muted">
                Not shown to any section of this course.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-rule">
                {released.map((row) => (
                  <li
                    className="flex items-center justify-between gap-3 py-2"
                    key={row.sectionId}
                  >
                    <span className="type-body text-ink">
                      {sectionLabelText(row.label)}
                    </span>
                    <ReleaseStatusChip
                      releasedVersion={row.releasedVersion}
                      status={row.status}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <details className="flex flex-col gap-1">
            <summary className="type-body inline-flex min-h-11 cursor-pointer items-center rounded-control text-ink focus-ring">
              Technical details
            </summary>
            <p className="type-small tabular text-ink">
              {question.publishedVersion === null
                ? "No version is ready to use yet"
                : `Version ${question.publishedVersion} is ready to use`}{" "}
              · newest version: {question.latestVersion} · code{" "}
              {questionCode(question.id)}
            </p>
          </details>
        </DialogBody>

        {hasAction || publishedNote !== undefined ? (
          <DialogFooter className="sm:justify-start">
            <div className="flex flex-col items-start gap-1">
              {hasAction ? (
                <QuestionAction
                  className="items-start"
                  onPreview={onPreview}
                  onPublish={onPublish}
                  question={question}
                  topicId={topicId}
                />
              ) : null}
              {publishedNote !== undefined ? (
                <PublishedNote version={publishedNote} />
              ) : null}
            </div>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
