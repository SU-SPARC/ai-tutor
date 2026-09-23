"use client";

import { ChevronDown, ChevronRight } from "lucide-react";

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

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * "Sep 22". Formatted by hand in UTC rather than via `toLocaleDateString` so
 * the label cannot drift between the server's ICU data and the browser's.
 */
export function formatOpensAt(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
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

/** Blueprint S3 rule 4: the availability state lives on the group header. */
const TOPIC_STATE_DOT: Record<TopicAvailabilityState, string> = {
  open: "text-success",
  closed: "text-muted-foreground",
  scheduled: "text-warning",
};

export function BuilderTopicHeader({
  availability,
  count,
  label,
  open,
  sectionId,
  topicId,
}: {
  availability: SectionTopicAvailability;
  /** Released rows in this topic, staged changes already folded in. */
  count: number;
  label: string;
  open: boolean;
  sectionId: SectionId;
  topicId: TopicId;
}) {
  const { dispatch } = useCoursesStore();
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-2">
      <Chevron
        className="h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span
        className={cn(
          "text-[0.6rem] leading-none",
          TOPIC_STATE_DOT[availability.state],
        )}
        aria-hidden="true"
      >
        ●
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {label}{" "}
        <span className="font-normal text-muted-foreground">({count})</span>
      </span>

      {/* Controls sit inside the <summary>; the parent stops the disclosure
          from toggling when a click lands on this wrapper. */}
      <div
        data-summary-interactive="true"
        className="flex flex-wrap items-center gap-2"
      >
        <NativeSelect
          className="h-8 w-[7.5rem] py-1 text-xs"
          aria-label={`Availability of ${label} for this section`}
          value={availability.state}
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
        >
          {TOPIC_STATE_ORDER.map((value) => (
            <option key={value} value={value}>
              {TOPIC_STATE_LABELS[value]}
            </option>
          ))}
        </NativeSelect>

        {availability.state === "scheduled" ? (
          <>
            <Input
              type="date"
              className="h-8 w-[9.5rem] py-1 text-xs"
              aria-label={`Date ${label} opens for this section`}
              value={(availability.opensAt ?? DEFAULT_SCHEDULED_OPENS_AT).slice(
                0,
                10,
              )}
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
            />
            <span className="text-xs text-muted-foreground">
              opens{" "}
              {formatOpensAt(
                availability.opensAt ?? DEFAULT_SCHEDULED_OPENS_AT,
              )}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}
