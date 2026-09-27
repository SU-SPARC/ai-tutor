"use client";

import Link from "next/link";
import { useEffect, useState, type KeyboardEvent } from "react";
import { ChevronDown, ChevronUp, Pencil } from "lucide-react";

import {
  TopicStateChip,
  plural,
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
import { courseTopicPath } from "@/lib/courses/paths";
import {
  courseTopicsOrdered,
  listSections,
  type CourseTopicView,
} from "@/lib/courses/selectors";
import type {
  CourseId,
  CoursesState,
  SectionTopicAvailability,
  TopicId,
} from "@/lib/courses/types";

/**
 * Only published questions can be released, so the count next to a topic is the
 * count of what is releasable — not everything that exists in the bank.
 */
function publishedCount(state: CoursesState, topicId: TopicId) {
  return state.bank.filter(
    (question) =>
      question.topicId === topicId && question.state === "published",
  ).length;
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
 * The course's opinion about the canonical syllabus: which topics it includes,
 * in what order, under what label. The overview shows it as a read list (each
 * topic opens its question page); ordering, renaming and excluding happen in a
 * dialog with keyboard move buttons. The canonical topic itself is never
 * touched, which is why the original title stays visible under a renamed row.
 */
export function CourseSyllabusOverlay({ courseId }: { courseId: CourseId }) {
  const { state } = useCoursesStore();
  const [editing, setEditing] = useState(false);

  const rows = courseTopicsOrdered(state, courseId);
  const included = rows.filter((row) => row.overlay.included);
  const excluded = rows.filter((row) => !row.overlay.included);
  const firstSection = listSections(state, courseId).find(
    (section) => section.status === "active",
  );

  const availabilityFor = (
    topicId: TopicId,
  ): Pick<SectionTopicAvailability, "state" | "opensAt"> =>
    (firstSection &&
      state.topicAvailability.find(
        (row) => row.sectionId === firstSection.id && row.topicId === topicId,
      )) || { state: "closed", opensAt: null };

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
            Syllabus{" "}
            <span className="type-mono align-middle text-ink-muted">
              {included.length}
            </span>
          </h2>
          <p className="type-small max-w-prose text-ink-muted">
            {canonical ? "Canonical order. " : "Reordered for this course. "}
            Counts are published questions; open and closed are for{" "}
            {firstSection ? firstSection.label : "the first section"}.
          </p>
        </div>
        <Button
          onClick={() => setEditing(true)}
          size="sm"
          type="button"
          variant="secondary"
        >
          <Pencil aria-hidden="true" />
          Edit syllabus
        </Button>
      </div>

      <ol className="flex flex-col divide-y divide-rule rounded-panel bg-sheet">
        {included.map((row) => {
          const availability = availabilityFor(row.topic.id);
          return (
            <li
              className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2"
              key={row.topic.id}
            >
              <span className="type-mono w-12 shrink-0 text-ink-muted">
                Wk {row.topic.weekNumber}
              </span>
              <div className="flex min-w-40 flex-1 flex-col">
                <Link
                  className="type-body w-fit rounded-xs text-ink underline-offset-4 hover:text-azure-700 hover:underline focus-ring"
                  href={courseTopicPath(courseId, row.topic.id)}
                >
                  {displayLabel(row)}
                </Link>
                {isRenamed(row) ? (
                  <span className="type-caption">{row.topic.title}</span>
                ) : null}
              </div>
              <span className="type-small shrink-0 tabular text-ink-muted">
                {publishedCount(state, row.topic.id)} published
              </span>
              <TopicStateChip
                opensAt={availability.opensAt}
                state={availability.state}
              />
            </li>
          );
        })}
        {included.length === 0 ? (
          <li className="type-body px-4 py-4 text-ink-muted">
            Every topic is excluded. Edit the syllabus to include one.
          </li>
        ) : null}
      </ol>

      {excluded.length > 0 ? (
        <p className="type-small text-ink-muted">
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
 * The editor. Changes dispatch as they happen (the reducer has no draft), so
 * the footer says so and the only exit is "Done". Move buttons stay focusable
 * at the ends of the list (`aria-disabled`), focus follows the moved row, and
 * each move is announced.
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
      `${displayLabel(row)} ${next ? "included in" : "excluded from"} this course.`,
    );
  }

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
            Order and labels belong to this course. The canonical topics never
            change.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-6">
          <p className="sr-only" role="status">
            {announcement}
          </p>
          <div className="flex flex-col gap-2">
            <h3 className="type-label">In this course ({included.length})</h3>
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
                        data-move={`up-${row.topic.id}`}
                        onClick={() => {
                          if (!first) {
                            move(row, "up");
                          }
                        }}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <ChevronUp aria-hidden="true" />
                      </Button>
                      <Button
                        aria-disabled={last || undefined}
                        aria-label={`Move ${label} down`}
                        data-move={`down-${row.topic.id}`}
                        onClick={() => {
                          if (!last) {
                            move(row, "down");
                          }
                        }}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <ChevronDown aria-hidden="true" />
                      </Button>
                    </div>
                    <span className="type-mono w-12 shrink-0 text-ink-muted">
                      Wk {row.topic.weekNumber}
                    </span>
                    <div className="flex min-w-48 flex-1 flex-col gap-1">
                      <Input
                        aria-label={`Display label for ${row.topic.title}`}
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
                        <span className="type-caption">
                          Canonical title: {row.topic.title}
                        </span>
                      ) : null}
                    </div>
                    <Button
                      onClick={() => setIncluded(row, false)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Exclude
                    </Button>
                  </li>
                );
              })}
            </ol>
          </div>

          {excluded.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="type-label">Excluded ({excluded.length})</h3>
              <ul className="flex flex-col divide-y divide-rule">
                {excluded.map((row) => (
                  <li
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                    key={row.topic.id}
                  >
                    <span className="type-mono w-12 shrink-0 text-ink-muted">
                      Wk {row.topic.weekNumber}
                    </span>
                    <span className="type-body min-w-40 flex-1 text-ink-muted">
                      {displayLabel(row)}
                    </span>
                    <span className="type-small tabular text-ink-muted">
                      {plural(
                        publishedCount(state, row.topic.id),
                        "published question",
                      )}
                    </span>
                    <Button
                      onClick={() => setIncluded(row, true)}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      Include
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter className="sm:justify-between">
          <p className="type-caption">Changes save as you make them.</p>
          <DialogClose asChild>
            <Button type="button">Done</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
