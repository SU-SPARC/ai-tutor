import Link from "next/link";

import { CourseChangeLink } from "@/components/course/course-change-link";
import { MAIN_CONTENT_ID } from "@/components/shell/skip-link";
import { Button } from "@/components/ui/button";

/**
 * What a course with no topics yet shows where the practice workspace would
 * be. It names the course and nothing else: no topic, question, or tutor
 * wording from any other course.
 */
export function CourseEmptyState({ courseTitle }: { courseTitle: string }) {
  return (
    <main
      id={MAIN_CONTENT_ID}
      tabIndex={-1}
      className="min-h-[calc(100svh-var(--header-h))] bg-surface px-4 py-10 outline-none sm:px-6 sm:py-16"
    >
      <section
        aria-labelledby="course-empty-title"
        className="sheet-shadow mx-auto flex w-full max-w-2xl flex-col gap-6 rounded-panel bg-sheet p-6 text-sheet-foreground sm:p-8"
      >
        <header className="flex flex-col gap-2">
          <h1 id="course-empty-title" className="type-h1 text-ink">
            {courseTitle}
          </h1>
          <p className="type-body max-w-prose text-ink-muted">
            {courseTitle} content has not been added yet.
          </p>
        </header>
        <div className="flex flex-wrap gap-3">
          <CourseChangeLink returnTo="/practice" />
          <Button asChild variant="outline" size="sm">
            <Link href="/learn">Back to Learn</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
