"use client";

import Link from "next/link";
import { useEffect, useState, type KeyboardEvent } from "react";
import { Pencil } from "lucide-react";

import { ConfirmDialog } from "@/components/courses/confirm-dialog";
import {
  plural,
  sectionLabelText,
  topicVisibilityText,
} from "@/components/courses/course-status";
import { useCoursesStore } from "@/components/courses/courses-store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { courseTopicPath } from "@/lib/courses/paths";
import {
  courseTopicsOrdered,
  listSections,
  type CourseTopicView,
} from "@/lib/courses/selectors";
import type { CourseId, CoursesState, TopicId } from "@/lib/courses/types";

/**
 * Only questions that are ready to use can be shown, so the count next to a
 * week is that count — not everything that exists in the bank.
 */
function publishedCount(state: CoursesState, topicId: TopicId) {
  return state.bank.filter(
    (question) =>
      question.topicId === topicId && question.state === "published",
  ).length;
}

/** Distinct questions shown to any section of this course in this week. */
function shownCount(state: CoursesState, courseId: CourseId, topicId: TopicId) {
  const sectionIds = new Set(
    state.sections
      .filter((section) => section.courseId === courseId)
      .map((section) => section.id),
  );
  const questionIds = new Set(
    state.bank
      .filter((question) => question.topicId === topicId)
      .map((question) => question.id),
  );
  return new Set(
    state.questionAvailability
      .filter(
        (row) =>
          row.state === "released" &&
          sectionIds.has(row.sectionId) &&
          questionIds.has(row.questionId),
      )
      .map((row) => row.questionId),
  ).size;
}

function displayLabel(row: CourseTopicView) {
  return row.overlay.displayLabel ?? row.topic.title;
}

function isRenamed(row: CourseTopicView) {
  return (
    row.overlay.displayLabel !== null &&
    row.overlay.displayLabel !== row.topic.title
  );
}

/**
 * The course's version of the standard syllabus: which weeks it includes, in
 * what order, under what name. The overview shows it as a read list (each
 * week opens its question page) with, per section, whether students can see
 * the week; ordering, renaming and removing happen in a dialog. The standard
 * syllabus itself never changes, which is why the original name stays
 * visible under a renamed row.
 */
export function CourseSyllabusOverlay({ courseId }: { courseId: CourseId }) {
  const { state } = useCoursesStore();
  const [editing, setEditing] = useState(false);

  const rows = courseTopicsOrdered(state, courseId);
  const included = rows.filter((row) => row.overlay.included);
  const excluded = rows.filter((row) => !row.overlay.included);
  const activeSections = listSections(state, courseId).filter(
    (section) => section.status === "active",
  );

  /** "Section 1: Yes · Section 2: From Sep 22" for one week. */
  const visibilityLine = (topicId: TopicId) =>
    activeSections
      .map((section) => {
        const row = state.topicAvailability.find(
          (candidate) =>
            candidate.sectionId === section.id && candidate.topicId === topicId,
        );
        return `${sectionLabelText(section)}: ${topicVisibilityText(
          row?.state ?? "closed",
          row?.opensAt ?? null,
        )}`;
      })
      .join(" · ");

  const canonical =
    included.length === rows.length &&
    included.every(
      (row, index) =>
        index === 0 || included[index - 1].topic.order < row.topic.order,
    );

  return (
    <section aria-labelledby="course-syllabus" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="type-h2 text-ink" id="course-syllabus">
            Syllabus
          </h2>
          <p className="type-body max-w-prose text-ink-muted">
            {plural(included.length, "week")} in{" "}
            {canonical ? "the standard order" : "your own order"}. Under each
            week: whether students in each section can see it.
          </p>
        </div>
        <Button
          className="min-h-11"
          onClick={() => setEditing(true)}
          type="button"
          variant="secondary"
        >
          <Pencil aria-hidden="true" />
          Edit syllabus
        </Button>
      </div>

      <ol className="flex flex-col divide-y divide-rule rounded-panel bg-sheet">
        {included.map((row) => {
          const visibility = visibilityLine(row.topic.id);
          return (
            <li
              className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2"
              key={row.topic.id}
            >
              <span className="type-body w-20 shrink-0 text-ink-muted">
                Week {row.topic.weekNumber}
              </span>
              <div className="flex min-w-40 flex-1 flex-col">
                <Link
                  className="type-body inline-flex min-h-11 w-fit items-center rounded-xs text-ink underline-offset-4 hover:text-azure-700 hover:underline focus-ring"
                  href={courseTopicPath(courseId, row.topic.id)}
                >
                  {displayLabel(row)}
                </Link>
                {isRenamed(row) ? (
                  <span className="type-small text-ink-muted">
                    Original name: {row.topic.title}
                  </span>
                ) : null}
                {visibility ? (
                  <span className="type-small text-ink">
                    Students can see this week: {visibility}
                  </span>
                ) : null}
              </div>
              <span className="type-small shrink-0 tabular text-ink-muted">
                {publishedCount(state, row.topic.id)} ready to use
              </span>
            </li>
          );
        })}
        {included.length === 0 ? (
          <li className="type-body px-4 py-4 text-ink-muted">
            No weeks are in this course. Edit the syllabus to add one back.
          </li>
        ) : null}
      </ol>

      {excluded.length > 0 ? (
        <p className="type-body text-ink-muted">
          Not in this course ({excluded.length}):{" "}
          {excluded.map((row) => displayLabel(row)).join(", ")}.
        </p>
      ) : null}

      <SyllabusEditorDialog
        courseId={courseId}
        onOpenChange={setEditing}
        open={editing}
      />
    </section>
  );
}

/**
 * The editor. Changes save as they happen (the reducer has no draft), so the
 * top and the footer say so and the only exit is "Done". Move buttons stay
 * focusable at the ends of the list (`aria-disabled`), focus follows the
 * moved row, and each move is announced. Removing a week asks first, because
 * its questions disappear for every section.
 */
function SyllabusEditorDialog({
  courseId,
  open,
  onOpenChange,
}: {
  courseId: CourseId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { state, dispatch } = useCoursesStore();
  const [announcement, setAnnouncement] = useState("");
  const [confirmingRemove, setConfirmingRemove] =
    useState<CourseTopicView | null>(null);
  const [pendingFocus, setPendingFocus] = useState<{
    target: string;
    nonce: number;
  } | null>(null);

  const rows = courseTopicsOrdered(state, courseId);
  const included = rows.filter((row) => row.overlay.included);
  const excluded = rows.filter((row) => !row.overlay.included);

  // A keyed row that React moves in the DOM can drop focus, so the button the
  // professor pressed is focused again once the new order has rendered.
  useEffect(() => {
    if (!pendingFocus) {
      return;
    }
    document
      .querySelector<HTMLElement>(
        `[data-move="${CSS.escape(pendingFocus.target)}"]`,
      )
      ?.focus();
  }, [pendingFocus]);

  /**
   * Moving past an excluded topic would look like nothing happened, because
   * excluded rows are listed separately. So a move steps over them until the
   * visible order actually changes.
   */
  function move(row: CourseTopicView, direction: "up" | "down") {
    const ordered = state.courseTopics
      .filter((entry) => entry.courseId === courseId)
      .sort((left, right) => left.position - right.position);
    const index = ordered.findIndex((entry) => entry.topicId === row.topic.id);
    if (index < 0) {
      return;
    }
    const step = direction === "up" ? -1 : 1;
    let target = index + step;
    while (
      target >= 0 &&
      target < ordered.length &&
      !ordered[target].included
    ) {
      target += step;
    }
    if (target < 0 || target >= ordered.length) {
      return;
    }
    const steps = Math.abs(target - index);
    for (let count = 0; count < steps; count += 1) {
      dispatch({
        type: "course/moveTopic",
        courseId,
        topicId: row.topic.id,
        direction,
      });
    }
    const visibleIndex = included.findIndex(
      (entry) => entry.topic.id === row.topic.id,
    );
    const position = visibleIndex + (direction === "up" ? 0 : 2);
    setAnnouncement(
      `${displayLabel(row)} moved to position ${position} of ${included.length}.`,
    );
    setPendingFocus((previous) => ({
      target: `${direction}-${row.topic.id}`,
      nonce: (previous?.nonce ?? 0) + 1,
    }));
  }

  function rename(topicId: TopicId, input: HTMLInputElement, title: string) {
    const trimmed = input.value.trim();
    // An empty label falls back to the canonical title, and the field shows it.
    input.value = trimmed.length === 0 ? title : trimmed;
    input.dataset.saved = input.value;
    dispatch({
      type: "course/updateTopic",
      courseId,
      topicId,
      patch: { displayLabel: trimmed.length === 0 ? null : trimmed },
    });
  }

  function setIncluded(row: CourseTopicView, next: boolean) {
    dispatch({
      type: "course/updateTopic",
      courseId,
      topicId: row.topic.id,
      patch: { included: next },
    });
    setAnnouncement(
      `Week ${row.topic.weekNumber} ${next ? "added back to" : "removed from"} this course.`,
    );
    if (!next) {
      toast({
        title: `Week ${row.topic.weekNumber} is removed from this course.`,
        description: "Its questions are hidden from every section.",
        tone: "success",
        action: {
          label: "Undo",
          onClick: () =>
            dispatch({
              type: "course/updateTopic",
              courseId,
              topicId: row.topic.id,
              patch: { included: true },
            }),
        },
        duration: 15_000,
      });
    }
  }

  const removingShown = confirmingRemove
    ? shownCount(state, courseId, confirmingRemove.topic.id)
    : 0;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        onEscapeKeyDown={(event) => {
          // Escape inside a label field reverts the edit first; the next
          // Escape closes the dialog. Closing would otherwise save on blur.
          const active = document.activeElement;
          if (
            active instanceof HTMLInputElement &&
            active.dataset.syllabusLabel !== undefined &&
            active.value !== active.dataset.saved
          ) {
            event.preventDefault();
            active.value = active.dataset.saved ?? "";
          }
        }}
        size="lg"
      >
        <DialogHeader>
          <DialogTitle>Edit syllabus</DialogTitle>
          <DialogDescription>
            Changes save as you make them. The order and names are for this
            course only; the standard syllabus does not change.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-6">
          <p className="sr-only" role="status">
            {announcement}
          </p>
          <div className="flex flex-col gap-2">
            <h3 className="type-body-strong text-ink">
              In this course ({included.length})
            </h3>
            <ol className="flex flex-col divide-y divide-rule">
              {included.map((row, index) => {
                const label = displayLabel(row);
                const first = index === 0;
                const last = index === included.length - 1;
                return (
                  <li
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2"
                    key={row.topic.id}
                  >
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        aria-disabled={first || undefined}
                        aria-label={`Move ${label} up`}
                        className="min-h-11"
                        data-move={`up-${row.topic.id}`}
                        onClick={() => {
                          if (!first) {
                            move(row, "up");
                          }
                        }}
                        type="button"
                        variant="outline"
                      >
                        Up
                      </Button>
                      <Button
                        aria-disabled={last || undefined}
                        aria-label={`Move ${label} down`}
                        className="min-h-11"
                        data-move={`down-${row.topic.id}`}
                        onClick={() => {
                          if (!last) {
                            move(row, "down");
                          }
                        }}
                        type="button"
                        variant="outline"
                      >
                        Down
                      </Button>
                    </div>
                    <span className="type-body w-20 shrink-0 text-ink-muted">
                      Week {row.topic.weekNumber}
                    </span>
                    <div className="flex min-w-48 flex-1 flex-col gap-1">
                      <label
                        className="type-small text-ink"
                        htmlFor={`syllabus-name-${row.topic.id}`}
                      >
                        Name shown to students
                      </label>
                      <Input
                        id={`syllabus-name-${row.topic.id}`}
                        autoComplete="off"
                        data-saved={label}
                        data-syllabus-label=""
                        defaultValue={label}
                        onBlur={(event) => {
                          const input = event.currentTarget;
                          if (input.value !== input.dataset.saved) {
                            rename(row.topic.id, input, row.topic.title);
                          }
                        }}
                        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            rename(
                              row.topic.id,
                              event.currentTarget,
                              row.topic.title,
                            );
                          }
                        }}
                      />
                      {isRenamed(row) ? (
                        <span className="type-small text-ink-muted">
                          Original name: {row.topic.title}
                        </span>
                      ) : null}
                    </div>
                    <Button
                      className="min-h-11"
                      onClick={() => setConfirmingRemove(row)}
                      type="button"
                      variant="ghost"
                    >
                      Remove from course
                    </Button>
                  </li>
                );
              })}
            </ol>
          </div>

          {excluded.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="type-body-strong text-ink">
                Not in this course ({excluded.length})
              </h3>
              <ul className="flex flex-col divide-y divide-rule">
                {excluded.map((row) => (
                  <li
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                    key={row.topic.id}
                  >
                    <span className="type-body w-20 shrink-0 text-ink-muted">
                      Week {row.topic.weekNumber}
                    </span>
                    <span className="type-body min-w-40 flex-1 text-ink-muted">
                      {displayLabel(row)}
                    </span>
                    <span className="type-small tabular text-ink-muted">
                      {plural(
                        publishedCount(state, row.topic.id),
                        "question",
                      )}{" "}
                      ready to use
                    </span>
                    <Button
                      className="min-h-11"
                      onClick={() => setIncluded(row, true)}
                      type="button"
                      variant="secondary"
                    >
                      Add back to course
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter className="sm:justify-between">
          <p className="type-body text-ink-muted">
            Changes save as you make them.
          </p>
          <DialogClose asChild>
            <Button className="min-h-11" type="button">
              Done
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
      <ConfirmDialog
        cancelLabel="Keep it"
        confirmLabel={
          confirmingRemove
            ? `Remove Week ${confirmingRemove.topic.weekNumber}`
            : "Remove"
        }
        description={
          confirmingRemove
            ? removingShown > 0
              ? `Its ${plural(removingShown, "shown question")} will be hidden from all sections.`
              : "No questions from it are shown to students now."
            : ""
        }
        destructive
        onConfirm={() => {
          if (confirmingRemove) {
            setIncluded(confirmingRemove, false);
          }
        }}
        onOpenChange={(next) => {
          if (!next) {
            setConfirmingRemove(null);
          }
        }}
        open={confirmingRemove !== null}
        title={
          confirmingRemove
            ? `Remove Week ${confirmingRemove.topic.weekNumber} from this course?`
            : "Remove this week?"
        }
      />
    </Dialog>
  );
}
