"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";

import { CourseCard } from "@/components/courses/course-card";
import {
  CourseFormDialog,
  type CourseFormRequest,
} from "@/components/courses/course-form-dialog";
import { plural } from "@/components/courses/course-status";
import { useCoursesStore } from "@/components/courses/courses-store";
import { DemoResetButton } from "@/components/courses/demo-reset-button";
import { NewCourseTile } from "@/components/courses/new-course-tile";
import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/components/ui/toast";
import { coursePath } from "@/lib/courses/paths";
import { courseSummary, listCourses } from "@/lib/courses/selectors";
import type { Course } from "@/lib/courses/types";
import { cn } from "@/lib/utils";

/**
 * S1. Every course the professor runs: active ones as a 2-up grid with one
 * attention line each, the archived ones behind a disclosure, and the demo
 * reset alone at the very bottom.
 */
export function CoursesIndexScreen() {
  const { state, dispatch } = useCoursesStore();
  const [form, setForm] = useState<CourseFormRequest | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const courses = listCourses(state);
  const active = courses.filter((course) => course.status === "active");
  const archived = courses.filter((course) => course.status === "archived");

  function unarchive(course: Course) {
    dispatch({ type: "course/unarchive", courseId: course.id });
    toast({
      title: `${course.code} ${course.term} is restored. Students can join again.`,
      tone: "success",
      action: {
        label: "Undo",
        onClick: () =>
          dispatch({ type: "course/archive", courseId: course.id }),
      },
      duration: 15_000,
    });
  }

  return (
    <ProfessorPageShell
      aside={
        <Button
          className="min-h-11"
          onClick={() => setForm({ mode: "create" })}
          type="button"
        >
          <Plus aria-hidden="true" />
          New course
        </Button>
      }
      description="A course has one or more sections (your class meetings). Each section has a join code for students, and you choose which questions each section sees, week by week."
      title="Courses"
    >
      <section aria-labelledby="courses-active" className="flex flex-col gap-4">
        <h2 className="type-h2 text-ink" id="courses-active">
          Active courses
        </h2>
        {active.length === 0 ? (
          <EmptyState
            action={
              <Button
                className="min-h-11"
                onClick={() => setForm({ mode: "create" })}
                type="button"
              >
                New course
              </Button>
            }
          >
            Your courses will appear here. Create one, or copy an old one for a
            new term.
          </EmptyState>
        ) : null}
        <ul className="grid gap-4 md:grid-cols-2">
          {active.map((course) => (
            <CourseCard
              course={course}
              key={course.id}
              summary={courseSummary(state, course.id)}
            />
          ))}
          <NewCourseTile courses={courses} onOpenForm={setForm} />
        </ul>
      </section>

      {archived.length > 0 ? (
        <section aria-labelledby="courses-archived" className="flex flex-col gap-3">
          <h2 className="type-h2 text-ink" id="courses-archived">
            <button
              aria-controls="courses-archived-list"
              aria-expanded={showArchived}
              className="-mx-2 inline-flex min-h-11 items-center gap-2 rounded-control px-2 transition-colors duration-fast hover:bg-hover focus-ring"
              onClick={() => setShowArchived((open) => !open)}
              type="button"
            >
              <ChevronRight
                aria-hidden="true"
                className={cn(
                  "size-5 text-ink-muted transition-transform duration-fast ease-out",
                  showArchived && "rotate-90",
                )}
              />
              Archived courses ({archived.length})
            </button>
          </h2>
          {showArchived ? (
            <ul
              className="flex flex-col divide-y divide-rule rounded-panel bg-sheet"
              id="courses-archived-list"
            >
              {archived.map((course) => {
                const summary = courseSummary(state, course.id);
                return (
                  <li
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2"
                    key={course.id}
                  >
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
                      <Link
                        className="type-body-strong rounded-xs text-ink underline-offset-4 hover:underline focus-ring"
                        href={coursePath(course.id)}
                      >
                        {course.code} · {course.term}
                      </Link>
                      <span className="type-small tabular text-ink-muted">
                        {plural(summary.sectionCount, "section")} ·{" "}
                        {plural(summary.studentCount, "student")} · students
                        can&rsquo;t join
                      </span>
                    </div>
                    <Button
                      aria-label={`Restore ${course.code} ${course.term}`}
                      className="min-h-11"
                      onClick={() => unarchive(course)}
                      type="button"
                      variant="outline"
                    >
                      Restore
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      ) : null}

      <DemoResetButton />

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
