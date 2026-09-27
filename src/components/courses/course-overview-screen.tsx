"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, Copy } from "lucide-react";

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
import { StatusChip } from "@/components/ui/status-chip";
import { toast } from "@/components/ui/toast";
import { coursesIndexPath } from "@/lib/courses/paths";
import {
  courseSummary,
  coursePipeline,
  getCourse,
} from "@/lib/courses/selectors";
import type { CourseId } from "@/lib/courses/types";

/** S2. One offering: what is in flight, who it reaches, and what it covers. */
export function CourseOverviewScreen({ courseId }: { courseId: CourseId }) {
  const { state, dispatch, hydrated } = useCoursesStore();
  const [form, setForm] = useState<CourseFormRequest | null>(null);

  const course = getCourse(state, courseId);
  const breadcrumbs = [
    { href: coursesIndexPath(), label: "Courses" },
    { label: course ? `${course.code} ${course.term}` : "Course" },
  ];

  if (!course) {
    // The server rendered the seed; a course created in this browser only
    // exists once the saved demo has been read, so wait for that first.
    if (!hydrated) {
      return (
        <CourseScreenSkeleton
          breadcrumbs={breadcrumbs}
          description="Reading this browser's demo data."
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

  function toggleArchived() {
    if (!course) {
      return;
    }
    const name = `${course.code} ${course.term}`;
    dispatch({
      type: archived ? "course/unarchive" : "course/archive",
      courseId: course.id,
    });
    toast({
      title: archived ? `${name} is active again` : `${name} archived`,
      action: {
        label: "Undo",
        onClick: () =>
          dispatch({
            type: archived ? "course/archive" : "course/unarchive",
            courseId: course.id,
          }),
      },
    });
  }

  return (
    <ProfessorPageShell
      aside={
        <>
          <Button
            onClick={() =>
              setForm({ mode: "clone", sourceCourseId: course.id })
            }
            type="button"
            variant="secondary"
          >
            <Copy aria-hidden="true" />
            Clone
          </Button>
          <Button onClick={toggleArchived} type="button" variant="ghost">
            {archived ? (
              <ArchiveRestore aria-hidden="true" />
            ) : (
              <Archive aria-hidden="true" />
            )}
            {archived ? "Unarchive" : "Archive"}
          </Button>
        </>
      }
      breadcrumbs={breadcrumbs}
      description={course.title}
      notice={
        <span className="flex flex-wrap items-center gap-2">
          {archived ? (
            <StatusChip icon={Archive} label="Archived" tone="neutral" />
          ) : null}
          <span>
            {plural(summary.sectionCount, "section")} ·{" "}
            {summary.studentCount} joined · {summary.topicCount} topics
          </span>
        </span>
      }
      title={`${course.code} · ${course.term}`}
    >
      <div className="flex flex-col gap-10">
        <ReleasePipelineStrip
          courseId={course.id}
          pipeline={pipeline}
          summary={summary}
        />
        <CourseSectionsList courseId={course.id} />
        <CourseSyllabusOverlay courseId={course.id} />
      </div>

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
