"use client";

import {
  UNJOINED_SECTION_LABEL,
  useStudentSection,
} from "@/components/shell/use-student-section";
import { cn } from "@/lib/utils";

// Matches the professor CourseSwitcher trigger: same height, padding, type.
const CHIP_CLASSES =
  "inline-flex h-8 min-w-0 max-w-full shrink items-center gap-1.5 rounded-control bg-surface-tint px-2.5 text-sm text-ink";

function splitLabel(label: string) {
  const separator = label.lastIndexOf(" · ");
  if (separator === -1) {
    return { course: label, detail: "" };
  }
  return {
    course: label.slice(0, separator),
    detail: label.slice(separator + 3),
  };
}

/**
 * The student's read-only counterpart to the professor's course switcher:
 * "MATH-255 · Section 1". Before hydration it renders the un-joined label
 * ("MATH-255 · Guest", muted), which is also what an un-joined student sees,
 * so the header never jumps and an un-joined chip never looks like a section.
 */
export function StudentSectionChip({ className }: { className?: string }) {
  const { section, hydrated } = useStudentSection();
  const joined = hydrated && section !== null;
  const label = joined && section ? section.label : UNJOINED_SECTION_LABEL;
  const { course, detail } = splitLabel(label);

  return (
    <span
      className={cn(CHIP_CLASSES, !joined && "text-ink-muted", className)}
      title={joined ? label : "No section joined yet"}
      data-joined={joined ? "true" : "false"}
    >
      <span className="shrink-0 font-mono">{course}</span>
      {detail ? (
        <>
          <span className="text-ink-muted" aria-hidden="true">
            ·
          </span>
          <span className="truncate">{detail}</span>
        </>
      ) : null}
    </span>
  );
}
