"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Archive, ChevronDown } from "lucide-react";

import { ConfirmDialog } from "@/components/courses/confirm-dialog";
import {
  CourseFormDialog,
  type CourseFormRequest,
} from "@/components/courses/course-form-dialog";
import { CourseNotFound } from "@/components/courses/course-not-found";
import { CourseScreenSkeleton } from "@/components/courses/course-screen-skeleton";
import { CourseSectionsList } from "@/components/courses/course-sections-list";
import { plural } from "@/components/courses/course-status";
import { CourseSyllabusOverlay } from "@/components/courses/course-syllabus-overlay";
import { useCoursesStore } from "@/components/courses/courses-store";
import { ReleasePipelineStrip } from "@/components/courses/release-pipeline-strip";
import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusChip } from "@/components/ui/status-chip";
import { toast } from "@/components/ui/toast";
import { courseTopicsPath, coursesIndexPath } from "@/lib/courses/paths";
import {
  courseSummary,
  coursePipeline,
  getCourse,
} from "@/lib/courses/selectors";
import type { CourseId } from "@/lib/courses/types";

/**
 * S2. One course, in the order a professor needs it: the sections and their
 * join codes, the one next step ("Choose questions for students"), the
 * syllabus, and last, folded away, the question status counts. Copy and
 * Archive are rare, so they live under "More options".
 */
export function CourseOverviewScreen({ courseId }: { courseId: CourseId }) {
  const { state, dispatch, hydrated } = useCoursesStore();
  const [form, setForm] = useState<CourseFormRequest | null>(null);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const course = getCourse(state, courseId);
  const breadcrumbs = [
    { href: coursesIndexPath(), label: "Courses" },
    { label: course ? `${course.code} ${course.term}` : "Course" },
  ];

  if (!course) {
    // The page renders before the store's first load from the server has
    // answered, so wait for it before calling the course missing.
    if (!hydrated) {
      return (
        <CourseScreenSkeleton
          breadcrumbs={breadcrumbs}
          description="Loading this course."
          shape="overview"
          title="Course"
        />
      );
    }
    return (
      <ProfessorPageShell
        breadcrumbs={[
          { href: coursesIndexPath(), label: "Courses" },
          { label: "Not found" },
        ]}
        description="This link does not match a course in this demo."
        title="Course not found"
      >
        <CourseNotFound what="course" />
      </ProfessorPageShell>
    );
  }

  const summary = courseSummary(state, courseId);
  const pipeline = coursePipeline(state, courseId);
  const archived = course.status === "archived";
  const name = `${course.code} ${course.term}`;

  function setArchived(next: boolean) {
    if (!course) {
      return;
    }
    dispatch({
      type: next ? "course/archive" : "course/unarchive",
      courseId: course.id,
    });
    toast({
      title: next
        ? `${name} is archived. Students can no longer join; their work is kept.`
        : `${name} is restored. Students can join again.`,
      tone: "success",
      action: {
        label: "Undo",
        onClick: () =>
          dispatch({
            type: next ? "course/unarchive" : "course/archive",
            courseId: course.id,
          }),
      },
      duration: 15_000,
    });
  }

  return (
    <ProfessorPageShell
      aside={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="min-h-11"
              ref={menuButtonRef}
              type="button"
              variant="outline"
            >
              More options
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-60">
            <DropdownMenuItem
              className="min-h-11"
              onSelect={() =>
                setForm({ mode: "clone", sourceCourseId: course.id })
              }
            >
              Copy for a new term
            </DropdownMenuItem>
            {archived ? (
              <DropdownMenuItem
                className="min-h-11"
                onSelect={() => setArchived(false)}
              >
                Restore this course
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                className="min-h-11"
                onSelect={() => setConfirmingArchive(true)}
              >
                Archive this course…
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      }
      breadcrumbs={breadcrumbs}
      description={course.title}
      notice={
        <span className="flex flex-wrap items-center gap-2">
          {archived ? (
            <StatusChip
              icon={Archive}
              label="Archived: students can't join"
              tone="neutral"
            />
          ) : null}
          <span>
            {plural(summary.sectionCount, "section")} ·{" "}
            {plural(summary.studentCount, "student")} joined ·{" "}
            {plural(summary.topicCount, "week")}
          </span>
        </span>
      }
      title={`${course.code} · ${course.term}`}
    >
      <div className="flex flex-col gap-10">
        <CourseSectionsList courseId={course.id} />

        <section
          aria-labelledby="course-next-step"
          className="flex flex-col items-start gap-3 rounded-panel bg-sheet p-5 sm:p-6"
        >
          <h2 className="type-h2 text-ink" id="course-next-step">
            Choose questions for students
          </h2>
          <p className="type-body max-w-prose text-ink">
            {summary.publishedNotReleased > 0
              ? `${plural(summary.publishedNotReleased, "question")} ${
                  summary.publishedNotReleased === 1 ? "is" : "are"
                } ready but not shown to students yet.`
              : "Pick which questions students in each section can see, week by week."}
          </p>
          <Button asChild className="min-h-11" variant="cta">
            <Link href={courseTopicsPath(course.id)}>
              Choose questions for students
            </Link>
          </Button>
        </section>

        <CourseSyllabusOverlay courseId={course.id} />

        <ReleasePipelineStrip
          courseId={course.id}
          pipeline={pipeline}
          summary={summary}
        />
      </div>

      <ConfirmDialog
        cancelLabel="Keep it active"
        confirmLabel={`Archive ${course.code} ${course.term}`}
        description="Students can no longer join; their work is kept. You can restore it later from the Courses page."
        destructive
        onConfirm={() => setArchived(true)}
        onOpenChange={(open) => {
          setConfirmingArchive(open);
          if (!open) {
            menuButtonRef.current?.focus();
          }
        }}
        open={confirmingArchive}
        title={`Archive ${name}?`}
      />

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
