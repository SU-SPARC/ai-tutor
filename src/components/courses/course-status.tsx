import {
  CalendarClock,
  CircleMinus,
  CirclePlus,
  History,
  Lock,
  PauseCircle,
} from "lucide-react";

import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { stateLabel } from "@/lib/courses/format";
import type { QuestionReleaseStatus } from "@/lib/courses/selectors";
import type {
  CourseSection,
  QuestionLifecycleState,
  TopicAvailabilityState,
} from "@/lib/courses/types";

/**
 * One chip vocabulary for every Courses screen, built on `StatusChip` so the
 * colours match the review queue and the question bank: draft, needs review,
 * approved, published, and "pulled back" (unpublished reads as retired).
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

/**
 * "Sep 22". Formatted by hand in UTC so the server and the browser print the
 * same label for the seed clock.
 */
export function formatShortDate(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/**
 * Whether a section can open a topic. Open means students can reach it, so it
 * shares the released tone; closed and scheduled are neutral with an icon.
 */
export function TopicStateChip({
  state,
  opensAt = null,
  className,
}: {
  state: TopicAvailabilityState;
  opensAt?: string | null;
  className?: string;
}) {
  if (state === "open") {
    return <StatusChip className={className} label="Open" tone="released" />;
  }
  if (state === "scheduled") {
    return (
      <StatusChip
        className={className}
        icon={CalendarClock}
        label={opensAt ? `Opens ${formatShortDate(opensAt)}` : "Scheduled"}
        tone="neutral"
      />
    );
  }
  return (
    <StatusChip className={className} icon={Lock} label="Closed" tone="neutral" />
  );
}

/**
 * A section's copy of a question: the version it pins, and whether that is
 * still the published one. "Older" waits on the professor, so it takes the
 * review tone; held and not released are quiet.
 */
export function ReleaseStatusChip({
  status,
  releasedVersion,
  className,
}: {
  status: QuestionReleaseStatus;
  releasedVersion: number | null;
  className?: string;
}) {
  switch (status) {
    case "live":
      return (
        <StatusChip
          className={className}
          label={`v${releasedVersion ?? "—"} live`}
          tone="released"
        />
      );
    case "older":
      return (
        <StatusChip
          className={className}
          icon={History}
          label={`v${releasedVersion ?? "—"} · older version`}
          tone="review"
        />
      );
    case "held":
      return (
        <StatusChip
          className={className}
          icon={PauseCircle}
          label="Held · version unpublished"
          tone="neutral"
        />
      );
    default:
      return (
        <StatusChip
          className={className}
          icon={false}
          label="Not released"
          tone="neutral"
        />
      );
  }
}

/** The chip a staged row carries until the professor applies or discards it. */
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
      label={kind === "add" ? "Adding" : "Removing"}
      tone="review"
    />
  );
}

/** "Sec 01 · MWF 10:00", or just "Sec 01" when no meeting time is set. */
export function sectionName(
  section: Pick<CourseSection, "label" | "meetingTime">,
): string {
  const time = section.meetingTime.trim();
  return time.length > 0 ? `${section.label} · ${time}` : section.label;
}

/** "1 section" / "2 sections". */
export function plural(count: number, singular: string, many = `${singular}s`) {
  return `${count} ${count === 1 ? singular : many}`;
}
