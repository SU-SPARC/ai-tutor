"use client";

import { useState } from "react";
import { Copy } from "lucide-react";

import {
  CourseFormDialog,
  type CourseFormRequest,
} from "@/components/courses/course-form-dialog";
import { CourseNotFound } from "@/components/courses/course-not-found";
import { CourseSectionsList } from "@/components/courses/course-sections-list";
import { CourseSyllabusOverlay } from "@/components/courses/course-syllabus-overlay";
import { useCoursesStore } from "@/components/courses/courses-store";
import { ReleasePipelineStrip } from "@/components/courses/release-pipeline-strip";
import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Button } from "@/components/ui/button";
import { coursesIndexPath } from "@/lib/courses/paths";
import {
  courseSummary,
  courseTopicsOrdered,
  coursePipeline,
  getCourse,
  type CourseTopicView,
} from "@/lib/courses/selectors";
import type { CourseId } from "@/lib/courses/types";

/**
 * "Syllabus follows canonical order (11 topics)" is the claim worth making when
 * it is true, because it means the professor can stop thinking about this card.
 * Anything else — a reorder, a dropped topic — has to say so.
 */
function syllabusLine(rows: CourseTopicView[]) {
  const included = rows.filter((row) => row.overlay.included);
  const canonical =
    included.length === rows.length &&
    included.every(
      (row, index) =>
        index === 0 || included[index - 1].topic.order < row.topic.order,
    );
  return canonical
    ? `Syllabus follows canonical order (${included.length} topics)`
    : `Syllabus reordered (${included.length} of ${rows.length} topics)`;
}

/** S2. One offering: what is in flight, who it reaches, and what it covers. */
export function CourseOverviewScreen({ courseId }: { courseId: CourseId }) {
  const { state, dispatch } = useCoursesStore();
  const [form, setForm] = useState<CourseFormRequest | null>(null);

  const course = getCourse(state, courseId);

  if (!course) {
    return (
      <ProfessorPageShell
        breadcrumbs={[
          { href: coursesIndexPath(), label: "Courses" },
          { label: "Not found" },
        ]}
        description="This link does not match a course in this demo."
        title="Course"
      >
        <CourseNotFound what="course" />
      </ProfessorPageShell>
    );
  }

  const summary = courseSummary(state, courseId);
  const pipeline = coursePipeline(state, courseId);
  const topics = courseTopicsOrdered(state, courseId);
  const archived = course.status === "archived";

  const status = `${archived ? "○ Archived" : "● Active"} · ${
    summary.sectionCount === 1
      ? "1 section"
      : `${summary.sectionCount} sections`
  } · ${syllabusLine(topics)}`;

  return (
    <ProfessorPageShell
      aside={
        <>
          <Button
            onClick={() =>
              setForm({ mode: "clone", sourceCourseId: course.id })
            }
            type="button"
            variant="outline"
          >
            <Copy className="h-4 w-4" />
            Clone
          </Button>
          <Button
            onClick={() =>
              dispatch({
                type: archived ? "course/unarchive" : "course/archive",
                courseId: course.id,
              })
            }
            type="button"
            variant="outline"
          >
            {archived ? "Unarchive" : "Archive"}
          </Button>
          {/* A disabled button swallows its own hover, so the explanation
              lives on a wrapper that can still be hovered. */}
          <span title="Not in this demo">
            <Button
              disabled
              title="Not in this demo"
              type="button"
              variant="ghost"
            >
              Settings
            </Button>
          </span>
        </>
      }
      breadcrumbs={[
        { href: coursesIndexPath(), label: "Courses" },
        { label: `${course.code} ${course.term}` },
      ]}
      description={status}
      title={`${course.code} · ${course.title} · ${course.term}`}
    >
      <ReleasePipelineStrip
        courseId={course.id}
        pipeline={pipeline}
        summary={summary}
      />
      <CourseSectionsList courseId={course.id} />
      <CourseSyllabusOverlay courseId={course.id} />

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
