"use client";

import { BookOpen } from "lucide-react";

import {
  UNJOINED_SECTION_LABEL,
  useStudentSection,
} from "@/components/shell/use-student-section";
import { cn } from "@/lib/utils";

// Matches the professor CourseSwitcher trigger so the two roles' headers line
// up on the same baseline: same height, same padding, same type size.
const CHIP_CLASSES =
  "inline-flex h-8 w-fit shrink-0 items-center gap-2 rounded-md border border-input bg-background px-2.5 text-sm font-medium";

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
 * The student's read-only counterpart to the professor's course switcher.
 * Before hydration it renders the un-joined label, which is also what an
 * un-joined student sees, so the header never changes height or jumps.
 */
export function StudentSectionChip({ className }: { className?: string }) {
  const { section, hydrated } = useStudentSection();
  const label = hydrated && section ? section.label : UNJOINED_SECTION_LABEL;
  const { course, detail } = splitLabel(label);

  return (
    <span className={cn(CHIP_CLASSES, className)} title={label}>
      <BookOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <span>{course}</span>
      {detail ? (
        <>
          <span className="text-muted-foreground" aria-hidden="true">
            ·
          </span>
          <span className="font-mono">{detail}</span>
        </>
      ) : null}
    </span>
  );
}
