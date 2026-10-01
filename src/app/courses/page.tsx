import type { Metadata } from "next";

import { selectCourseAction } from "@/app/courses/actions";
import { MAIN_CONTENT_ID } from "@/components/shell/skip-link";
import { Button } from "@/components/ui/button";
import { safeReturnPath } from "@/lib/auth/return-path";
import { getSelectedCourse } from "@/lib/course-selection";
import { listTopics } from "@/lib/data/data-store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Choose course",
};

type CoursesPageProps = {
  searchParams: Promise<{ returnTo?: string }>;
};

/**
 * Choose a course. The same learning pages load for whichever course is
 * chosen; the choice decides only which topics and questions appear, and each
 * course keeps its own progress. A course with no topics yet is still listed,
 * with a plain note, so nobody wonders where it went.
 */
export default async function CoursesPage({ searchParams }: CoursesPageProps) {
  const { returnTo } = await searchParams;
  const destination = safeReturnPath(returnTo);
  const [{ course: selected, courses }, topics] = await Promise.all([
    getSelectedCourse(),
    listTopics().catch(() => []),
  ]);
  const topicCountByCourse = new Map<string, number>();
  for (const topic of topics) {
    topicCountByCourse.set(
      topic.courseId,
      (topicCountByCourse.get(topic.courseId) ?? 0) + 1,
    );
  }

  return (
    <main
      id={MAIN_CONTENT_ID}
      tabIndex={-1}
      className="min-h-[calc(100svh-var(--header-h))] bg-surface px-4 py-10 outline-none sm:px-6 sm:py-16"
    >
      <section
        aria-labelledby="courses-title"
        className="sheet-shadow mx-auto flex w-full max-w-2xl flex-col gap-8 rounded-panel bg-sheet p-6 text-sheet-foreground sm:p-8"
      >
        <header className="flex flex-col gap-2">
          <h1 id="courses-title" className="type-h1 text-ink">
            Choose course
          </h1>
          <p className="type-body max-w-prose text-ink-muted">
            Your progress is kept separately for each course. Switching never
            changes it.
          </p>
        </header>

        <ul className="flex flex-col gap-4">
          {courses
            .filter((course) => course.active)
            .map((course) => {
              const topicCount = topicCountByCourse.get(course.id) ?? 0;
              const isSelected = course.id === selected.id;
              return (
                <li key={course.id}>
                  <form
                    action={selectCourseAction}
                    className="flex flex-col gap-3 rounded-control bg-surface-tint p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <input type="hidden" name="courseId" value={course.id} />
                    <input type="hidden" name="returnTo" value={destination} />
                    <div className="flex min-w-0 flex-col gap-1">
                      <h2 className="type-h3 text-ink">{course.title}</h2>
                      <p className="type-small text-ink-muted">
                        {topicCount > 0
                          ? `${topicCount} ${topicCount === 1 ? "topic" : "topics"}`
                          : "Content has not been added yet."}
                      </p>
                    </div>
                    <Button
                      type="submit"
                      variant={isSelected ? "secondary" : "primary"}
                      aria-label={
                        isSelected
                          ? `${course.title} (current course)`
                          : `Choose ${course.title}`
                      }
                    >
                      {isSelected ? "Current course" : "Choose"}
                    </Button>
                  </form>
                </li>
              );
            })}
        </ul>
      </section>
    </main>
  );
}
