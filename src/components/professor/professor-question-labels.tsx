import {
  Bookmark,
  CircleX,
  EyeOff,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";

import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { difficultyLabel } from "@/lib/labels";
import type {
  Difficulty,
  QuestionLifecycleDto,
  QuestionCreationMethod,
  QuestionRevisionMethod,
  QuestionValidationStatus,
  QuestionVersionState,
  SourceType,
} from "@/lib/types";

/**
 * Human words for the lifecycle enums the professor screens show. Stored
 * values never reach the page directly; every state, method and source goes
 * through one of these maps so the same thing is always called the same.
 */

export type QuestionDisplayState = QuestionVersionState | "archived";

export const QUESTION_STATE_LABELS: Record<QuestionDisplayState, string> = {
  approved: "Approved",
  archived: "Removed",
  draft: "Being written",
  needs_review: "Waiting for your review",
  published: "Students can see it",
  rejected: "Rejected",
  revision_requested: "Sent back for changes",
  unpublished: "Hidden from students",
};

/**
 * Lifecycle states on the foundation's StatusChip tones: "Students can see
 * it" is the one mint chip, a sent-back version reads as a draft again, and
 * red is used only for rejected and removed.
 */
const QUESTION_STATE_CHIPS: Record<
  QuestionDisplayState,
  { icon?: LucideIcon; tone: StatusTone }
> = {
  approved: { tone: "approved" },
  archived: { tone: "retired" },
  draft: { tone: "draft" },
  needs_review: { tone: "review" },
  published: { tone: "released" },
  rejected: { icon: CircleX, tone: "retired" },
  revision_requested: { icon: RotateCcw, tone: "draft" },
  unpublished: { icon: EyeOff, tone: "neutral" },
};

export function questionStateLabel(state: QuestionDisplayState) {
  return QUESTION_STATE_LABELS[state] ?? state;
}

export function QuestionStateChip({
  className,
  state,
}: {
  className?: string;
  state: QuestionDisplayState;
}) {
  const chip = QUESTION_STATE_CHIPS[state] ?? { tone: "neutral" as const };
  return (
    <StatusChip
      className={className}
      icon={chip.icon ?? true}
      label={questionStateLabel(state)}
      tone={chip.tone}
    />
  );
}

/** "Saved for later" is a disposition, not a lifecycle state: a quiet chip. */
export function SavedForLaterChip({
  practiceAllowed,
}: {
  practiceAllowed?: boolean;
}) {
  return (
    <StatusChip
      icon={Bookmark}
      label={
        practiceAllowed ? "Saved for later · extra practice" : "Saved for later"
      }
      tone="neutral"
    />
  );
}

const CREATION_METHOD_LABELS: Record<QuestionCreationMethod, string> = {
  generated: "Written by AI",
  imported: "Imported",
  manual: "Edited by an instructor",
  regenerated: "Rewritten by AI",
  rollback_clone: "Copy of an earlier version",
};

export function creationMethodLabel(method: QuestionCreationMethod) {
  return CREATION_METHOD_LABELS[method] ?? method.replaceAll("_", " ");
}

const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  generated_original: "Written by AI",
  original_demo: "Sample question",
  pattern_derived_original: "Written by AI from a course example",
  private_reference_pattern: "Private course example",
  professor_provided: "Written by an instructor",
};

export function sourceTypeLabel(sourceType: SourceType) {
  return SOURCE_TYPE_LABELS[sourceType] ?? sourceType.replaceAll("_", " ");
}

const VALIDATION_LABELS: Record<QuestionValidationStatus, string> = {
  invalid: "Has problems",
  pending: "Not checked yet",
  valid: "Passed the automatic checks",
};

export function validationStatusLabel(status: QuestionValidationStatus) {
  return VALIDATION_LABELS[status] ?? status;
}

export const REVISION_METHOD_LABELS: Record<QuestionRevisionMethod, string> = {
  manual: "Edit it myself",
  regeneration: "Rewrite with AI",
};

/** Difficulty in professor words ("Foundational"), never a colour. */
export function professorDifficultyLabel(difficulty: Difficulty | string) {
  return difficultyLabel(difficulty as Difficulty);
}

// Timestamps are shown in the course's own time zone (Suffolk University,
// Boston) with the zone named, so the server render, the browser and the
// tests all agree, and nobody reads a raw ISO string.
const COURSE_TIME_ZONE = "America/New_York";

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: COURSE_TIME_ZONE,
});

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: COURSE_TIME_ZONE,
});

const ZONE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: COURSE_TIME_ZONE,
  timeZoneName: "short",
});

// Anything within a day of the Unix epoch is a missing value that was stored
// as 0, never a real moment: it would read "Dec 31, 1969".
const EPOCH_GUARD_MS = 24 * 60 * 60 * 1000;

function parseDate(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) || Math.abs(time) <= EPOCH_GUARD_MS
    ? undefined
    : date;
}

function zoneName(date: Date) {
  return (
    ZONE_FORMAT.formatToParts(date).find((part) => part.type === "timeZoneName")
      ?.value ?? ""
  );
}

/** "Sep 18, 2026, 2:47 PM EDT"; a missing or unreadable value becomes "—". */
export function formatProfessorDateTime(value: string) {
  const date = parseDate(value);
  if (!date) return "—";
  const zone = zoneName(date);
  return `${DATE_TIME_FORMAT.format(date)}${zone ? ` ${zone}` : ""}`;
}

/** "Sep 18, 2026"; a missing or unreadable value becomes "—". */
export function formatProfessorDate(value: string) {
  const date = parseDate(value);
  return date ? DATE_FORMAT.format(date) : "—";
}

/**
 * A timestamp for people, with the exact instant kept machine-readable in
 * `dateTime` for assistive tech and copy-paste into support requests.
 */
export function ProfessorTime({
  className,
  dateOnly = false,
  value,
}: {
  className?: string;
  dateOnly?: boolean;
  value: string;
}) {
  const date = parseDate(value);
  if (!date) {
    return <span className={className}>—</span>;
  }
  return (
    <time className={className} dateTime={value}>
      {dateOnly ? formatProfessorDate(value) : formatProfessorDateTime(value)}
    </time>
  );
}

/**
 * Keep a tab or view in the address bar without a server round trip, so a
 * reload or a shared link opens the same view.
 */
export function replaceSearchParam(key: string, value: string | undefined) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (value) {
    url.searchParams.set(key, value);
  } else {
    url.searchParams.delete(key);
  }
  window.history.replaceState(null, "", url);
}

/**
 * What a failed request says to the professor. Server messages can name
 * internal machinery, so only the status decides the sentence.
 */
export function plainActionError(status?: number, serverMessage?: string) {
  if (status === 409) {
    return "Someone changed this question while you were looking at it. Reload the page to see the latest version, then try again.";
  }
  if (serverMessage && /publication blocked/i.test(serverMessage)) {
    return "This question isn't ready to show to students. Open it, fix what's listed, and approve it again.";
  }
  return "That didn't work and nothing changed. Try again, or reload the page.";
}

/** Shown in the PageHeader notice whenever a page cannot save. */
export const DEMO_NOTICE = "Demo: changes on this page are not saved.";

/**
 * The version students can see right now, when it is not the one being
 * worked on (an edit waiting for review, for example). Undefined when the
 * two are the same or students see nothing. Lives here (no "use client") so
 * server components can call it.
 */
export function olderVisibleVersion(question: QuestionLifecycleDto) {
  const published = question.publishedVersion;
  if (!published || question.recordState !== "active") return undefined;
  return published.versionId !== question.workingVersion.versionId
    ? published
    : undefined;
}
