"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";

import { CourseCard } from "@/components/courses/course-card";
import {
  CourseFormDialog,
  type CourseFormRequest,
} from "@/components/courses/course-form-dialog";
import { useCoursesStore } from "@/components/courses/courses-store";
import { DemoResetButton } from "@/components/courses/demo-reset-button";
import { NewCourseTile } from "@/components/courses/new-course-tile";
import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Button } from "@/components/ui/button";
import { coursePath } from "@/lib/courses/paths";
import { courseSummary, listCourses } from "@/lib/courses/selectors";

/**
 * S1. Every offering the professor runs, active first, with the create and
 * clone affordances inside the grid rather than only in the header.
 */
export function CoursesIndexScreen() {
  const { state, dispatch } = useCoursesStore();
  const [form, setForm] = useState<CourseFormRequest | null>(null);

  const courses = listCourses(state);
  const active = courses.filter((course) => course.status === "active");
  const archived = courses.filter((course) => course.status === "archived");

  return (
    <ProfessorPageShell
      aside={
        <>
          <DemoResetButton />
          <Button onClick={() => setForm({ mode: "create" })} type="button">
            <Plus className="h-4 w-4" />
            New course
          </Button>
        </>
      }
      description="One course per offering. Clone last term instead of rebuilding."
      title="Courses"
    >
      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Active
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((course) => (
            <CourseCard
              course={course}
              key={course.id}
              summary={courseSummary(state, course.id)}
            />
          ))}
          <NewCourseTile courses={courses} onOpenForm={setForm} />
        </div>
      </section>

      {archived.length > 0 ? (
        <details className="group rounded-lg border border-border bg-card shadow-xs">
          <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-xs font-medium tracking-wide text-muted-foreground uppercase outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden="true"
              className="h-4 w-4 text-muted-foreground transition-transform group-[[open]]:rotate-90"
            />
            Archived ({archived.length})
          </summary>
          <ul className="flex flex-col border-t border-border">
            {archived.map((course) => {
              const summary = courseSummary(state, course.id);
              return (
                <li
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 text-sm last:border-b-0"
                  key={course.id}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      className="font-medium underline-offset-4 hover:underline"
                      href={coursePath(course.id)}
                    >
                      {course.code} · {course.term}
                    </Link>
                    <span className="text-muted-foreground">
                      {summary.sectionCount} sections · {summary.studentCount}{" "}
                      joined
                    </span>
                  </div>
                  <Button
                    onClick={() =>
                      dispatch({
                        type: "course/unarchive",
                        courseId: course.id,
                      })
                    }
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Unarchive
                  </Button>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}

      {form ? (
        <CourseFormDialog
          mode={form.mode}
          onClose={() => setForm(null)}
          sourceCourseId={form.sourceCourseId}
        />
      ) : null}
    </ProfessorPageShell>
  );
}
