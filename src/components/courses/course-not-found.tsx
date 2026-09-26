import Link from "next/link";

import { Button } from "@/components/ui/button";
import { coursesIndexPath } from "@/lib/courses/paths";

/**
 * Course state lives in the browser, so the server cannot know whether an ID
 * exists. Pages validate the ID's shape and let the client render this when the
 * store has no such record (and only after the store has read this browser's
 * saved demo, so a course created here never flashes as missing).
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
        That {what} is not in this demo
      </h2>
      <p className="type-body max-w-prose text-ink-muted">
        The link may come from an older demo state, or the {what} was removed.
        Nothing was changed.
      </p>
      <Button asChild variant="secondary">
        <Link href={coursesIndexPath()}>Back to courses</Link>
      </Button>
    </section>
  );
}
