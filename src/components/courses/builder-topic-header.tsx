"use client";

import { ChevronRight } from "lucide-react";

import { formatShortDate } from "@/components/courses/course-status";
import { useCoursesStore } from "@/components/courses/courses-store";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { SEED_NOW } from "@/lib/courses/demo-seed";
import { cn } from "@/lib/utils";
import type {
  SectionId,
  SectionTopicAvailability,
  TopicAvailabilityState,
  TopicId,
} from "@/lib/courses/types";

const DAY_MS = 86_400_000;

/**
 * A scheduled topic defaults to a week out. The clock is the seed clock, never
 * `Date.now()`, so the server and the client render the same date.
 */
export const DEFAULT_SCHEDULED_OPENS_AT = new Date(
  new Date(SEED_NOW).getTime() + 7 * DAY_MS,
).toISOString();

/** "Sep 22", in UTC so the label cannot drift between server and browser. */
export function formatOpensAt(iso: string | null): string {
  return formatShortDate(iso);
}

const TOPIC_STATE_LABELS: Record<TopicAvailabilityState, string> = {
  open: "Open",
  closed: "Closed",
  scheduled: "Scheduled",
};

const TOPIC_STATE_ORDER: TopicAvailabilityState[] = [
  "open",
  "closed",
  "scheduled",
];

/**
 * A topic group's header on the builder: a disclosure button (inside the h3)
 * with the live count, and beside it, never inside it, the section's
 * availability for the topic. Availability dispatches immediately; only the
 * question set is staged.
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
}: {
  availability: SectionTopicAvailability;
  /** Released rows in this topic, staged changes already folded in. */
  count: number;
  headingId: string;
  label: string;
  /** The id of the list this header shows and hides. */
  listId: string;
  onToggle: () => void;
  open: boolean;
  sectionId: SectionId;
  sectionLabel: string;
  topicId: TopicId;
}) {
  const { dispatch } = useCoursesStore();
  const opensAt = availability.opensAt ?? DEFAULT_SCHEDULED_OPENS_AT;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-surface-tint px-3 py-1.5">
      <h3 className="min-w-0 flex-1" id={headingId}>
        <button
          aria-controls={listId}
          aria-expanded={open}
          className="flex min-h-10 w-full min-w-0 items-center gap-2 rounded-control text-left focus-ring"
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
          <span className="type-mono shrink-0 text-ink-muted">
            {count}
            <span className="sr-only"> released</span>
          </span>
        </button>
      </h3>

      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          aria-label={`Availability of ${label} for ${sectionLabel}`}
          className="h-8 w-32 py-0 pointer-coarse:h-11"
          onChange={(event) => {
            const nextState = event.target.value as TopicAvailabilityState;
            dispatch({
              type: "section/setTopicState",
              sectionId,
              topicId,
              state: nextState,
              opensAt:
                nextState === "scheduled"
                  ? (availability.opensAt ?? DEFAULT_SCHEDULED_OPENS_AT)
                  : null,
            });
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
          <Input
            aria-label={`Date ${label} opens for ${sectionLabel}`}
            className="h-8 w-40 py-0 pointer-coarse:h-11"
            onChange={(event) => {
              const value = event.target.value;
              if (!value) {
                return;
              }
              dispatch({
                type: "section/setTopicState",
                sectionId,
                topicId,
                state: "scheduled",
                opensAt: `${value}T15:00:00.000Z`,
              });
            }}
            title={`Opens ${formatOpensAt(opensAt)}`}
            type="date"
            value={opensAt.slice(0, 10)}
          />
        ) : null}
      </div>
    </div>
  );
}
