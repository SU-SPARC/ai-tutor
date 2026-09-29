"use client";

import { ChevronDown, Copy } from "lucide-react";

import type { CourseFormRequest } from "@/components/courses/course-form-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Course } from "@/lib/courses/types";

/**
 * The quiet tile at the end of the course grid. "New course" is the page's
 * primary action in the header; this tile carries the other way in ("Copy
 * for a new term"), because next term is almost always last term plus edits.
 */
export function NewCourseTile({
  courses,
  onOpenForm,
}: {
  courses: Course[];
  onOpenForm: (request: CourseFormRequest) => void;
}) {
  return (
    <li className="flex flex-col items-start gap-3 rounded-panel bg-surface-tint p-5">
      <h3 className="type-h3 text-ink">Next term</h3>
      <p className="type-body max-w-prose text-ink-muted">
        Copy a course to reuse its weeks and sections. Each copied section gets
        a new join code.
      </p>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            className="mt-auto min-h-11"
            disabled={courses.length === 0}
            type="button"
            variant="secondary"
          >
            <Copy aria-hidden="true" />
            Copy for a new term
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-64">
          <DropdownMenuLabel>Copy which course?</DropdownMenuLabel>
          {courses.map((course) => (
            <DropdownMenuItem
              className="min-h-11"
              key={course.id}
              onSelect={() =>
                onOpenForm({ mode: "clone", sourceCourseId: course.id })
              }
            >
              <span className="flex flex-col">
                <span className="type-body text-ink">
                  {course.code} · {course.term}
                </span>
                <span className="type-small text-ink-muted">
                  {course.status === "archived" ? "Archived" : "Active"} ·{" "}
                  {course.title}
                </span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
