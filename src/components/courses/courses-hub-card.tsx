"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { useOptionalCoursesStore } from "@/components/courses/courses-store";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { coursePath, coursesIndexPath } from "@/lib/courses/paths";
import { courseSummary } from "@/lib/courses/selectors";

/**
 * The hub's way into the course tools. It shows the course every other
 * professor tool is currently scoped to, and the one number that decides
 * whether the professor needs to go there now.
 */
export function CoursesHubCard() {
  // The hub is also rendered outside the /professor layout in tests, where no
  // store is mounted; the card simply stays out of the way there.
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
      <Card>
        <CardHeader>
          <CardTitle>Courses</CardTitle>
          <CardDescription>
            No active course is selected. Pick one to scope the rest of the
            workspace to it.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Button asChild variant="outline">
            <Link href={coursesIndexPath()}>
              All courses
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const summary = courseSummary(state, course.id);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Courses</CardTitle>
        <CardDescription>
          {course.code} · {course.term}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-0">
        <p className="text-sm leading-6">
          {summary.sectionCount === 1
            ? "1 section"
            : `${summary.sectionCount} sections`}{" "}
          · {summary.studentCount} joined · {summary.approvedNotReleased}{" "}
          waiting to release
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="ghost">
            <Link href={coursesIndexPath()}>All courses</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={coursePath(course.id)}>
              Open course
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
