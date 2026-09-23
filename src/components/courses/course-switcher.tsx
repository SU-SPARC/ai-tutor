"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, Check, ChevronDown } from "lucide-react";

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

const TRIGGER_CLASSES = "h-8 gap-2 px-2.5 text-sm font-medium";

function courseLabel(code: string, term: string) {
  return `${code} · ${term}`;
}

/**
 * The one control that scopes every professor tool. It lives in the section nav
 * rather than the page header so it survives navigation between tools.
 *
 * Two defensive shapes here: it renders nothing without a provider (the nav is
 * also importable outside /professor), and it renders a disabled trigger with
 * the seeded course name until the store has hydrated, so the nav row never
 * changes height when localStorage comes back.
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
      <Button
        aria-hidden
        className={cn(TRIGGER_CLASSES, className)}
        disabled
        size="sm"
        tabIndex={-1}
        variant="outline"
      >
        <BookOpen className="h-4 w-4" />
        {label}
        <ChevronDown className="h-4 w-4 opacity-60" />
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`Active course: ${label}. Switch course.`}
          className={cn(TRIGGER_CLASSES, className)}
          size="sm"
          variant="outline"
        >
          <BookOpen className="h-4 w-4" />
          {label}
          <ChevronDown className="h-4 w-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel>Active courses</DropdownMenuLabel>
        {activeCourses.length === 0 ? (
          <DropdownMenuItem disabled>No active courses</DropdownMenuItem>
        ) : (
          activeCourses.map((course) => {
            const selected = course.id === active?.id;
            return (
              <DropdownMenuItem
                key={course.id}
                onSelect={() =>
                  dispatch({ type: "course/setActive", courseId: course.id })
                }
              >
                <Check
                  className={cn(
                    "h-4 w-4",
                    selected ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="flex flex-col">
                  <span>{courseLabel(course.code, course.term)}</span>
                  <span className="text-xs text-muted-foreground">
                    {course.title}
                  </span>
                </span>
              </DropdownMenuItem>
            );
          })
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/professor/courses">
            <ArrowRight className="h-4 w-4" />
            All courses
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
