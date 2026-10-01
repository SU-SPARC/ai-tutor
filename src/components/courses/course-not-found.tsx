import Link from "next/link";

import { Button } from "@/components/ui/button";
import { coursesIndexPath } from "@/lib/courses/paths";

/**
 * Pages only validate an ID's shape; the client store (loaded from
 * /api/professor/courses, which only returns the signed-in professor's own
 * courses) renders this when it has no such record, and only after its first
 * load has answered, so a real course never flashes as missing.
 */
export function CourseNotFound({
  what = "course",
}: {
  what?: "course" | "section" | "topic" | "question";
}) {
  return (
    <section
      aria-labelledby="course-not-found-title"
      className="flex max-w-2xl flex-col items-start gap-3 rounded-panel bg-sheet p-6"
    >
      <h2 className="type-h2 text-ink" id="course-not-found-title">
        We couldn&rsquo;t find that {what}
      </h2>
      <p className="type-body max-w-prose text-ink-muted">
        The link may be out of date, belong to another professor&rsquo;s course,
        or the {what} was removed. Nothing was changed.
      </p>
      <Button asChild className="min-h-11" variant="secondary">
        <Link href={coursesIndexPath()}>Back to courses</Link>
      </Button>
    </section>
  );
}
