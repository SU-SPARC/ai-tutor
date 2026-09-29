"use client";

import { useId } from "react";
import { ChevronRight } from "lucide-react";

import {
  formatShortDate,
  formatWeekdayDate,
} from "@/components/courses/course-status";
import { useCoursesStore } from "@/components/courses/courses-store";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toast";
import { SEED_NOW } from "@/lib/courses/demo-seed";
import { cn } from "@/lib/utils";
import type {
  SectionId,
  SectionTopicAvailability,
  TopicAvailabilityState,
  TopicId,
} from "@/lib/courses/types";

const DAY_MS = 86_400_000;
const UNDO_TOAST_MS = 15_000;

/**
 * A week set to open later defaults to a week out. The clock is the seed
 * clock, never `Date.now()`, so the server and the client render the same date.
 */
export const DEFAULT_SCHEDULED_OPENS_AT = new Date(
  new Date(SEED_NOW).getTime() + 7 * DAY_MS,
).toISOString();

/** "Sep 22", in UTC so the label cannot drift between server and browser. */
export function formatOpensAt(iso: string | null): string {
  return formatShortDate(iso);
}

const TOPIC_STATE_LABELS: Record<TopicAvailabilityState, string> = {
  open: "Yes, now",
  closed: "No",
  scheduled: "From a date…",
};

const TOPIC_STATE_ORDER: TopicAvailabilityState[] = [
  "open",
  "closed",
  "scheduled",
];

/** "Week 3 is now open to Section 1." — what changed for students, in words. */
function weekChangeSentence(
  weekNumber: number,
  sectionLabel: string,
  state: TopicAvailabilityState,
  opensAt: string | null,
) {
  if (state === "open") {
    return `Week ${weekNumber} is now open to ${sectionLabel}.`;
  }
  if (state === "scheduled") {
    return `Week ${weekNumber} opens to ${sectionLabel} on ${formatWeekdayDate(opensAt)}.`;
  }
  return `Week ${weekNumber} is now closed to ${sectionLabel}.`;
}

/**
 * A week group's header on the builder: a disclosure button (inside the h3)
 * with the count, and beside it, never inside it, "Students can see this
 * week: Yes / No / From {date}". This control changes what students see right
 * away (it is not part of the waiting changes), so every change says so in a
 * toast with Undo.
 */
export function BuilderTopicHeader({
  availability,
  count,
  headingId,
  label,
  listId,
  onToggle,
  open,
  sectionId,
  sectionLabel,
  topicId,
  weekNumber,
}: {
  availability: SectionTopicAvailability;
  /** Shown rows in this week, waiting changes already folded in. */
  count: number;
  headingId: string;
  label: string;
  /** The id of the list this header shows and hides. */
  listId: string;
  onToggle: () => void;
  open: boolean;
  sectionId: SectionId;
  /** Already in words: "Section 1". */
  sectionLabel: string;
  topicId: TopicId;
  weekNumber: number;
}) {
  const { dispatch } = useCoursesStore();
  const selectId = useId();
  const dateId = useId();
  const opensAt = availability.opensAt ?? DEFAULT_SCHEDULED_OPENS_AT;

  const setWeekState = (
    nextState: TopicAvailabilityState,
    nextOpensAt: string | null,
  ) => {
    const previousState = availability.state;
    const previousOpensAt = availability.opensAt;
    dispatch({
      type: "section/setTopicState",
      sectionId,
      topicId,
      state: nextState,
      opensAt: nextOpensAt,
    });
    toast({
      title: weekChangeSentence(weekNumber, sectionLabel, nextState, nextOpensAt),
      description: "This changed for students right away.",
      tone: "success",
      action: {
        label: "Undo",
        onClick: () =>
          dispatch({
            type: "section/setTopicState",
            sectionId,
            topicId,
            state: previousState,
            opensAt: previousOpensAt,
          }),
      },
      duration: UNDO_TOAST_MS,
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-surface-tint px-3 py-2">
      <h3 className="min-w-0 flex-1 basis-56" id={headingId}>
        <button
          aria-controls={listId}
          aria-expanded={open}
          className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-control text-left focus-ring"
          onClick={onToggle}
          type="button"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0 text-ink-muted transition-transform duration-fast ease-out",
              open && "rotate-90",
            )}
          />
          <span className="type-body-strong min-w-0 truncate text-ink">
            {label}
          </span>
          <span className="type-small shrink-0 text-ink-muted">
            {count === 1 ? "1 question" : `${count} questions`}
          </span>
        </button>
      </h3>

      <div className="flex flex-wrap items-center gap-2">
        <label className="type-body text-ink" htmlFor={selectId}>
          Students can see this week:
        </label>
        <NativeSelect
          className="min-h-11 w-auto"
          id={selectId}
          onChange={(event) => {
            const nextState = event.target.value as TopicAvailabilityState;
            setWeekState(
              nextState,
              nextState === "scheduled"
                ? (availability.opensAt ?? DEFAULT_SCHEDULED_OPENS_AT)
                : null,
            );
          }}
          value={availability.state}
        >
          {TOPIC_STATE_ORDER.map((value) => (
            <option key={value} value={value}>
              {TOPIC_STATE_LABELS[value]}
            </option>
          ))}
        </NativeSelect>

        {availability.state === "scheduled" ? (
          <>
            <label className="sr-only" htmlFor={dateId}>
              Date {label} opens for {sectionLabel}
            </label>
            <Input
              className="min-h-11 w-44"
              id={dateId}
              onChange={(event) => {
                const value = event.target.value;
                if (!value) {
                  return;
                }
                setWeekState("scheduled", `${value}T15:00:00.000Z`);
              }}
              type="date"
              value={opensAt.slice(0, 10)}
            />
            <span className="type-body text-ink">
              Opens {formatWeekdayDate(opensAt)}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}
