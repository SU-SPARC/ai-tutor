import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { coursePath } from "@/lib/courses/paths";
import type { CourseSummary } from "@/lib/courses/selectors";
import type { Course } from "@/lib/courses/types";

/**
 * One offering, with the facts in the order a professor scans them: which
 * course and term, how big, how much is out there, and then, last and alone,
 * the one thing that is waiting on them. The whole panel is the hit target;
 * the link's name stays short ("MATH-255 Fall 2026").
 */
export function CourseCard({
  course,
  summary,
}: {
  course: Course;
  summary: CourseSummary;
}) {
  // "Ready" means ready to use and could be shown today; approved questions
  // still need one more step, so they are not counted here.
  const waiting = summary.publishedNotReleased;

  const facts: { label: string; value: number }[] = [
    { label: "Sections", value: summary.sectionCount },
    { label: "Students", value: summary.studentCount },
    { label: "Weeks", value: summary.topicCount },
    { label: "Shown to students", value: summary.releasedCount },
  ];

  return (
    <li className="group relative flex flex-col gap-4 rounded-panel bg-sheet p-5 transition-colors duration-fast hover:bg-hover has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-ring">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="type-h3 text-ink">
            <Link
              className="outline-none after:absolute after:inset-0 after:rounded-panel"
              href={coursePath(course.id)}
            >
              <span className="type-mono mr-2 text-ink-muted">
                {course.code}
              </span>
              {course.term}
            </Link>
          </h3>
          <p className="type-body truncate text-ink-muted">{course.title}</p>
        </div>
        <ArrowRight
          aria-hidden="true"
          className="mt-1 size-5 shrink-0 text-ink-muted transition-transform duration-fast ease-out group-hover:translate-x-0.5"
        />
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {facts.map((fact) => (
          <div className="flex flex-col" key={fact.label}>
            <dt className="type-small text-ink-muted">{fact.label}</dt>
            <dd className="type-mono text-ink">{fact.value}</dd>
          </div>
        ))}
      </dl>

      {waiting > 0 ? (
        <p className="type-body-strong mt-auto border-l-2 border-azure-500 pl-3 text-ink">
          {waiting} {waiting === 1 ? "question" : "questions"} ready but not
          shown to students
        </p>
      ) : (
        <p className="type-body mt-auto border-l-2 border-rule pl-3 text-ink-muted">
          Nothing waiting on you
        </p>
      )}
    </li>
  );
}
