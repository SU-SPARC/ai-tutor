import {
  CalendarClock,
  CircleMinus,
  CirclePlus,
  EyeOff,
  History,
  Lock,
  PauseCircle,
} from "lucide-react";

import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { friendlySectionLabel, stateLabel } from "@/lib/courses/format";
import type { QuestionReleaseStatus } from "@/lib/courses/selectors";
import type {
  CourseSection,
  QuestionLifecycleState,
  TopicAvailabilityState,
} from "@/lib/courses/types";

/**
 * One chip vocabulary for every Courses screen, built on `StatusChip` so the
 * colours match the review queue and the question bank. The words come from
 * the professor vocabulary: Being written, Waiting for your review, Approved,
 * Ready to use, Hidden from students.
 */
export const QUESTION_STATE_TONE: Record<QuestionLifecycleState, StatusTone> = {
  draft: "draft",
  needs_review: "review",
  approved: "approved",
  published: "published",
  unpublished: "retired",
};

export function QuestionStateChip({
  state,
  className,
}: {
  state: QuestionLifecycleState;
  className?: string;
}) {
  return (
    <StatusChip
      className={className}
      label={stateLabel(state)}
      tone={QUESTION_STATE_TONE[state]}
    />
  );
}

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

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * "Sep 22". Formatted by hand in UTC so the server and the browser print the
 * same label for the seed clock. Missing or epoch-0 dates print "—".
 */
export function formatShortDate(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) {
    return "—";
  }
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/** "Mon, Sep 22" — the date a week opens, printed as text beside its control. */
export function formatWeekdayDate(iso: string | null): string {
  const short = formatShortDate(iso);
  if (short === "—" || !iso) {
    return short;
  }
  return `${WEEKDAYS[new Date(iso).getUTCDay()]}, ${short}`;
}

/** "Yes" / "No" / "From Sep 22": whether students can see a week. */
export function topicVisibilityText(
  state: TopicAvailabilityState,
  opensAt: string | null = null,
): string {
  if (state === "open") {
    return "Yes";
  }
  if (state === "scheduled") {
    return opensAt ? `From ${formatShortDate(opensAt)}` : "From a date";
  }
  return "No";
}

/**
 * Whether students in a section can see a week. Open shares the "shown" tone;
 * closed and scheduled are neutral with an icon. The label always says it in
 * words: "Students can see this week: No".
 */
export function TopicStateChip({
  state,
  opensAt = null,
  className,
  prefix = "Students can see this week:",
}: {
  state: TopicAvailabilityState;
  opensAt?: string | null;
  className?: string;
  /** Words before Yes / No / From {date}; pass "" inside a labelled column. */
  prefix?: string;
}) {
  const text = topicVisibilityText(state, opensAt);
  const label = prefix ? `${prefix} ${text}` : text;
  if (state === "open") {
    return <StatusChip className={className} label={label} tone="released" />;
  }
  if (state === "scheduled") {
    return (
      <StatusChip
        className={className}
        icon={CalendarClock}
        label={label}
        tone="neutral"
      />
    );
  }
  return (
    <StatusChip className={className} icon={Lock} label={label} tone="neutral" />
  );
}

/**
 * A section's copy of a question: shown with the current version, shown with
 * an older one (waits on the professor, so it takes the review tone), paused
 * because the version was withdrawn, or not shown.
 */
export function ReleaseStatusChip({
  status,
  className,
}: {
  status: QuestionReleaseStatus;
  /** Kept for callers; version numbers stay out of the default view. */
  releasedVersion?: number | null;
  className?: string;
}) {
  switch (status) {
    case "live":
      return (
        <StatusChip
          className={className}
          label="Shown (current version)"
          tone="released"
        />
      );
    case "older":
      return (
        <StatusChip
          className={className}
          icon={History}
          label="Shown (older version)"
          tone="review"
        />
      );
    case "held":
      return (
        <StatusChip
          className={className}
          icon={PauseCircle}
          label="Paused: this version was withdrawn"
          tone="neutral"
        />
      );
    default:
      return (
        <StatusChip
          className={className}
          icon={EyeOff}
          label="Not shown"
          tone="neutral"
        />
      );
  }
}

/** The chip a row carries until the professor saves or discards its change. */
export function StagedChip({
  kind,
  className,
}: {
  kind: "add" | "remove";
  className?: string;
}) {
  return (
    <StatusChip
      className={className}
      icon={kind === "add" ? CirclePlus : CircleMinus}
      label={kind === "add" ? "Will show (not saved yet)" : "Will hide (not saved yet)"}
      tone="review"
    />
  );
}

/** "Section 1" for the short seed labels, otherwise what the professor typed. */
export function sectionLabelText(
  section: Pick<CourseSection, "label"> | string,
): string {
  return friendlySectionLabel(
    typeof section === "string" ? section : section.label,
  );
}

/** "Section 1 · MWF 10:00", or just "Section 1" when no meeting time is set. */
export function sectionName(
  section: Pick<CourseSection, "label" | "meetingTime">,
): string {
  const label = sectionLabelText(section);
  const time = section.meetingTime.trim();
  return time.length > 0 ? `${label} · ${time}` : label;
}

/** "1 section" / "2 sections". */
export function plural(count: number, singular: string, many = `${singular}s`) {
  return `${count} ${count === 1 ? singular : many}`;
}
