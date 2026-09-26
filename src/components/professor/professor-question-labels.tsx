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
  archived: "Archived",
  draft: "Draft",
  needs_review: "Needs review",
  published: "Published",
  rejected: "Rejected",
  revision_requested: "Revision requested",
  unpublished: "Unpublished",
};

/**
 * Lifecycle states on the foundation's StatusChip tones: the five pipeline
 * stages keep their own tone, a sent-back version reads as a draft again, and
 * red is used only for rejected and archived.
 */
const QUESTION_STATE_CHIPS: Record<
  QuestionDisplayState,
  { icon?: LucideIcon; tone: StatusTone }
> = {
  approved: { tone: "approved" },
  archived: { tone: "retired" },
  draft: { tone: "draft" },
  needs_review: { tone: "review" },
  published: { tone: "published" },
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
      label={practiceAllowed ? "Saved + practice" : "Saved for later"}
      tone="neutral"
    />
  );
}

const CREATION_METHOD_LABELS: Record<QuestionCreationMethod, string> = {
  generated: "Generated",
  imported: "Imported",
  manual: "Professor edit",
  regenerated: "Regenerated",
  rollback_clone: "Rollback copy",
};

export function creationMethodLabel(method: QuestionCreationMethod) {
  return CREATION_METHOD_LABELS[method] ?? method.replaceAll("_", " ");
}

const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  generated_original: "Generated original",
  original_demo: "Original demo question",
  pattern_derived_original: "Pattern-derived original",
  private_reference_pattern: "Private reference pattern",
  professor_provided: "Professor provided",
};

export function sourceTypeLabel(sourceType: SourceType) {
  return SOURCE_TYPE_LABELS[sourceType] ?? sourceType.replaceAll("_", " ");
}

const VALIDATION_LABELS: Record<QuestionValidationStatus, string> = {
  invalid: "Failed validation",
  pending: "Not validated yet",
  valid: "Valid",
};

export function validationStatusLabel(status: QuestionValidationStatus) {
  return VALIDATION_LABELS[status] ?? status;
}

export const REVISION_METHOD_LABELS: Record<QuestionRevisionMethod, string> =
  {
    manual: "Manual revision",
    regeneration: "Regeneration",
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

function parseDate(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function zoneName(date: Date) {
  return (
    ZONE_FORMAT.formatToParts(date).find((part) => part.type === "timeZoneName")
      ?.value ?? ""
  );
}

/** "Sep 18, 2026, 2:47 PM EDT"; unknown values come back unchanged. */
export function formatProfessorDateTime(value: string) {
  const date = parseDate(value);
  if (!date) return value;
  const zone = zoneName(date);
  return `${DATE_TIME_FORMAT.format(date)}${zone ? ` ${zone}` : ""}`;
}

/** "Sep 18, 2026"; unknown values come back unchanged. */
export function formatProfessorDate(value: string) {
  const date = parseDate(value);
  return date ? DATE_FORMAT.format(date) : value;
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
    return <span className={className}>{value || "—"}</span>;
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
