"use client";

import Link from "next/link";
import { ArrowRight, Check, ChevronDown } from "lucide-react";

import { useOptionalCoursesStore } from "@/components/courses/courses-store";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const TRIGGER_CLASSES =
  "h-11 min-w-0 max-w-full gap-1.5 bg-surface-tint px-3 text-base font-normal hover:bg-hover";

function courseLabel(code: string, term: string) {
  return `${code} · ${term}`;
}

/**
 * The one control that scopes every professor tool. It lives in the app
 * header (the chip slot), so it survives navigation between tools.
 *
 * Two defensive shapes: it renders nothing without a provider (the header is
 * also rendered outside the courses store), and until the store has hydrated
 * it renders a static chip with the seeded course name, so the header never
 * changes width when localStorage comes back. That placeholder is plain text,
 * not a disabled button, so it is not mistaken for a control.
 */
export function CourseSwitcher({ className }: { className?: string }) {
  const store = useOptionalCoursesStore();
  if (!store) {
    return null;
  }

  const { state, dispatch, hydrated } = store;
  const active =
    state.courses.find((course) => course.id === state.activeCourseId) ??
    state.courses.find((course) => course.status === "active");
  const activeCourses = state.courses.filter(
    (course) => course.status === "active",
  );

  const label = active
    ? courseLabel(active.code, active.term)
    : "No active course";

  if (!hydrated) {
    return (
      <span
        className={cn(
          "inline-flex h-11 min-w-0 items-center gap-1.5 rounded-control bg-surface-tint px-3 text-base text-ink",
          className,
        )}
      >
        <CourseLabel label={label} />
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`Active course: ${label}. Switch course.`}
          className={cn(TRIGGER_CLASSES, className)}
          variant="ghost"
        >
          <CourseLabel label={label} />
          <ChevronDown aria-hidden="true" className="size-4 text-ink-muted" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel>Work in which course?</DropdownMenuLabel>
        {activeCourses.length === 0 ? (
          <DropdownMenuItem disabled>No active courses</DropdownMenuItem>
        ) : (
          activeCourses.map((course) => {
            const selected = course.id === active?.id;
            return (
              <DropdownMenuItem
                className="min-h-11"
                key={course.id}
                onSelect={() =>
                  dispatch({ type: "course/setActive", courseId: course.id })
                }
              >
                <Check
                  aria-hidden="true"
                  className={cn(
                    "size-4 text-azure-500",
                    selected ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="flex flex-col">
                  <span>{courseLabel(course.code, course.term)}</span>
                  <span className="type-small text-ink-muted">
                    {course.title}
                  </span>
                </span>
              </DropdownMenuItem>
            );
          })
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="min-h-11">
          <Link href="/professor/courses">
            <ArrowRight aria-hidden="true" />
            All courses
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "MATH-255 · Fall 2026": the code in mono, the term truncating first. */
function CourseLabel({ label }: { label: string }) {
  const separator = label.indexOf(" · ");
  if (separator === -1) {
    return <span className="truncate">{label}</span>;
  }
  return (
    <>
      <span className="shrink-0 font-mono">{label.slice(0, separator)}</span>
      <span aria-hidden="true" className="text-ink-muted">
        ·
      </span>
      <span className="truncate">{label.slice(separator + 3)}</span>
    </>
  );
}
