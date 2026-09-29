"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { plural } from "@/components/courses/course-status";
import { useOptionalCoursesStore } from "@/components/courses/courses-store";
import { Button } from "@/components/ui/button";
import { coursePath, coursesIndexPath } from "@/lib/courses/paths";
import { courseSummary } from "@/lib/courses/selectors";

/**
 * The hub's line into the course tools: the course every other professor
 * tool is scoped to, and the one number that decides whether the professor
 * needs to go there now. The overview puts it under its own h2 "Courses",
 * so the card's title is an h3.
 */
export function CoursesHubCard() {
  // The hub is also rendered outside the /professor layout in tests, where no
  // store is mounted; the panel simply stays out of the way there.
  const store = useOptionalCoursesStore();
  if (!store) {
    return null;
  }
  const { state } = store;
  const course = state.courses.find(
    (candidate) => candidate.id === state.activeCourseId,
  );

  if (!course) {
    return (
      <section
        aria-labelledby="courses-hub-title"
        className="flex flex-wrap items-center justify-between gap-4 rounded-panel bg-sheet p-5"
      >
        <div className="flex flex-col gap-1">
          <h3 className="type-h3 text-ink" id="courses-hub-title">
            No active course
          </h3>
          <p className="type-body text-ink-muted">
            Choose a course to work in.
          </p>
        </div>
        <Button asChild className="min-h-11" variant="secondary">
          <Link href={coursesIndexPath()}>
            All courses
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </section>
    );
  }

  const summary = courseSummary(state, course.id);
  const waiting = summary.approvedNotReleased;

  return (
    <section
      aria-labelledby="courses-hub-title"
      className="flex flex-wrap items-center justify-between gap-4 rounded-panel bg-sheet p-5"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="type-h3 text-ink" id="courses-hub-title">
          <span className="type-mono mr-2 text-ink-muted">{course.code}</span>
          {course.term}
        </h3>
        <p className="type-body tabular text-ink-muted">
          {plural(summary.sectionCount, "section")} ·{" "}
          {plural(summary.studentCount, "student")} joined ·{" "}
          {waiting > 0 ? (
            <span className="text-ink">
              {waiting} approved, not yet shown to students
            </span>
          ) : (
            "nothing waiting to be shown to students"
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild className="min-h-11" variant="ghost">
          <Link href={coursesIndexPath()}>All courses</Link>
        </Button>
        <Button asChild className="min-h-11" variant="secondary">
          <Link href={coursePath(course.id)}>
            Open course
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
