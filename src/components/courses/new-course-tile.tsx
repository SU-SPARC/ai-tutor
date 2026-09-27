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
 * primary action in the header; this tile carries the other way in, because
 * next term is almost always last term plus edits.
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
      <p className="type-small max-w-prose text-ink-muted">
        Clone an offering to copy its topics and sections. The question bank
        stays shared.
      </p>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            className="mt-auto"
            disabled={courses.length === 0}
            type="button"
            variant="secondary"
          >
            <Copy aria-hidden="true" />
            Clone a course
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-64">
          <DropdownMenuLabel>Clone from</DropdownMenuLabel>
          {courses.map((course) => (
            <DropdownMenuItem
              key={course.id}
              onSelect={() =>
                onOpenForm({ mode: "clone", sourceCourseId: course.id })
              }
            >
              <span className="flex flex-col">
                <span className="type-body text-ink">
                  {course.code} · {course.term}
                </span>
                <span className="type-caption">
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
