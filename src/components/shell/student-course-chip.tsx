import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Matches the section chip and the professor CourseSwitcher trigger.
const CHIP_CLASSES =
  "inline-flex h-8 min-w-0 max-w-full shrink items-center gap-1.5 rounded-control bg-surface-tint px-2.5 text-sm text-ink focus-ring";

/**
 * The header's way to the course chooser. It wraps the section chip for the
 * default course, and stands alone (as the course name) for any other, so a
 * student always sees which course they are in and can change it.
 */
export function StudentCourseChip({
  children,
  className,
  courseTitle,
}: {
  /** The existing section chip, shown for the default course. */
  children?: ReactNode;
  className?: string;
  courseTitle: string;
}) {
  return (
    <Link
      href="/courses"
      aria-label={`Course: ${courseTitle}. Change course`}
      title="Change course"
      className={cn(children ? "rounded-control focus-ring" : CHIP_CLASSES, className)}
    >
      {children ?? <span className="truncate">{courseTitle}</span>}
    </Link>
  );
}
