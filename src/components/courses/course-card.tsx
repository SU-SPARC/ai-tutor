import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Card } from "@/components/ui/card";
import { coursePath } from "@/lib/courses/paths";
import type { CourseSummary } from "@/lib/courses/selectors";
import type { Course } from "@/lib/courses/types";

/** "1 section" / "2 sections" — counts on these cards are read, not parsed. */
function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * One offering, with the facts in the order a professor scans them: which
 * course, which term, how big, how much is out there — and then, last and
 * alone, the one thing that is waiting on them.
 */
export function CourseCard({
  course,
  summary,
}: {
  course: Course;
  summary: CourseSummary;
}) {
  const waiting = summary.approvedNotReleased;

  return (
    <Card className="transition-colors focus-within:border-primary/40 hover:border-primary/40">
      <Link
        className="flex h-full flex-col gap-4 rounded-lg p-5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        href={coursePath(course.id)}
      >
        <div className="flex flex-col gap-1">
          <span className="font-semibold">{course.code}</span>
          <span className="text-sm leading-6 text-muted-foreground">
            {course.title} · {course.term}
          </span>
        </div>

        <div className="flex flex-col gap-1 text-sm leading-6">
          <span>
            {plural(summary.sectionCount, "section")} · {summary.studentCount}{" "}
            joined
          </span>
          <span className="text-muted-foreground">
            {plural(summary.topicCount, "topic")} · {summary.releasedCount}{" "}
            released
          </span>
        </div>

        {waiting > 0 ? (
          <p className="flex items-center gap-2 text-sm leading-6">
            <span>{waiting} approved, not yet released</span>
            <span aria-hidden className="text-warning">
              ●
            </span>
          </p>
        ) : (
          <p className="text-sm leading-6 text-muted-foreground">
            Nothing waiting on you
          </p>
        )}

        <span className="mt-auto inline-flex items-center gap-1.5 pt-1 text-sm font-medium text-primary">
          Open
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </span>
      </Link>
    </Card>
  );
}
