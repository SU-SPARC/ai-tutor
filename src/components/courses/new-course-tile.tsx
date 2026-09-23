"use client";

import { ChevronDown, Plus } from "lucide-react";

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
 * The create affordance lives inside the collection rather than only in the
 * header, because at three or four courses the grid *is* the menu. Clone is a
 * dropdown on the same tile: next term is almost always last term plus edits.
 */
export function NewCourseTile({
  courses,
  onOpenForm,
}: {
  courses: Course[];
  onOpenForm: (request: CourseFormRequest) => void;
}) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/40 p-5 text-center">
      <Button onClick={() => onOpenForm({ mode: "create" })} type="button">
        <Plus className="h-4 w-4" />
        New course
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            className="text-muted-foreground"
            disabled={courses.length === 0}
            size="sm"
            type="button"
            variant="ghost"
          >
            or clone
            <ChevronDown className="h-4 w-4 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="min-w-56">
          <DropdownMenuLabel>Clone an existing course</DropdownMenuLabel>
          {courses.map((course) => (
            <DropdownMenuItem
              key={course.id}
              onSelect={() =>
                onOpenForm({ mode: "clone", sourceCourseId: course.id })
              }
            >
              <span className="flex flex-col">
                <span>
                  {course.code} · {course.term}
                </span>
                <span className="text-xs text-muted-foreground">
                  {course.status === "archived" ? "Archived" : "Active"} ·{" "}
                  {course.title}
                </span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <p className="text-xs leading-5 text-muted-foreground">
        Cloning copies topics and sections, never the question bank.
      </p>
    </div>
  );
}
