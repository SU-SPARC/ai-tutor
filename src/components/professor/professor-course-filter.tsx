import { selectCourseAction } from "@/app/courses/actions";
import { Button } from "@/components/ui/button";
import type { PlatformCourse } from "@/lib/course-catalog";

/**
 * The course a professor is working in. Every list on the page below it is for
 * that one course, so questions, review queues, availability, and analytics
 * from different courses are never mixed. A professor may work in any course;
 * choosing one is a view filter, not a permission.
 */
export function ProfessorCourseFilter({
  courses,
  returnTo,
  selectedCourseId,
}: {
  courses: readonly PlatformCourse[];
  /** The page to come back to after choosing a course. */
  returnTo: string;
  selectedCourseId: string;
}) {
  return (
    <div
      role="group"
      aria-label="Course"
      data-slot="professor-course-filter"
      className="flex flex-wrap items-center gap-2"
    >
      <span className="type-label">Course</span>
      {courses
        .filter((course) => course.active)
        .map((course) => {
          const selected = course.id === selectedCourseId;
          return (
            <form key={course.id} action={selectCourseAction}>
              <input type="hidden" name="courseId" value={course.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <Button
                type="submit"
                size="sm"
                variant={selected ? "primary" : "secondary"}
                aria-pressed={selected}
              >
                {course.title}
              </Button>
            </form>
          );
        })}
    </div>
  );
}
