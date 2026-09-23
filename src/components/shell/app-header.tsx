import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { CourseSwitcher } from "@/components/courses/course-switcher";
import { NavLink } from "@/components/shell/nav-link";
import { StudentSectionChip } from "@/components/shell/student-section-chip";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type AppHeaderRole = "student" | "professor";

export type AppHeaderProps = {
  accountControl?: ReactNode;
  environmentLabel?: "Development" | "Local demo" | "Preview" | "Preview demo";
  role?: AppHeaderRole;
  className?: string;
};

type NavItem = {
  href: string;
  label: string;
  title?: string;
};

// Two nav words, no more. Everything else a student can reach is reachable
// from the syllabus rail or the account menu.
const STUDENT_NAV: NavItem[] = [
  { href: "/learn", label: "Learn" },
  { href: "/practice", label: "Practice" },
];

const PROFESSOR_NAV: NavItem[] = [
  { href: "/professor", label: "Workspace" },
  { href: "/learn", label: "Learn", title: "View as student" },
];

/**
 * The one header for both roles. 56px, no border — a 1px surface-tint band
 * beneath it separates it from the page, so the header reads as part of the
 * same sheet of paper rather than a floating bar.
 *
 * It is a server component: the role comes from the root layout, which already
 * resolves the principal, and only the three genuinely interactive pieces (the
 * nav links, the section chip, the theme toggle) are client islands.
 */
export function AppHeader({
  accountControl,
  environmentLabel,
  role,
  className,
}: AppHeaderProps) {
  const navItems = role === "professor" ? PROFESSOR_NAV : STUDENT_NAV;

  return (
    <header className={cn("sticky top-0 z-40 bg-background", className)}>
      <div className="mx-auto flex w-full min-h-14 max-w-[90rem] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Image
            src="/logo.png"
            alt=""
            width={28}
            height={28}
            priority
            className="h-7 w-7"
          />
          <span className="font-display text-[17px] leading-none">
            ProbStat Tutor
          </span>
        </Link>

        <div className="flex items-center">
          {role === "professor" ? (
            <>
              {/* The switcher renders nothing outside the courses store, so the
               * fallback chip below stands in — `:only-child` picks whichever
               * one actually made it into the DOM. */}
              <CourseSwitcher />
              <FallbackCourseChip className="[&:not(:only-child)]:hidden" />
            </>
          ) : (
            <StudentSectionChip />
          )}
        </div>

        <nav
          aria-label="Primary"
          className="order-last flex w-full items-center gap-1 sm:order-none sm:w-auto"
        >
          {navItems.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              title={item.title}
            />
          ))}
        </nav>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1 whitespace-nowrap">
          {environmentLabel ? (
            <Badge
              variant="outline"
              title={`Non-production environment: ${environmentLabel}`}
            >
              {environmentLabel}
            </Badge>
          ) : null}
          {accountControl}
          <ThemeToggle />
        </div>
      </div>

      {/* A band, not a border: the page below is the same colour, so the
       * header edge reads as a fold rather than a rule. */}
      <div aria-hidden="true" className="h-px w-full bg-surface-tint" />
    </header>
  );
}

function FallbackCourseChip({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-8 w-fit shrink-0 items-center rounded-md border border-input bg-background px-2.5 text-sm font-medium",
        className,
      )}
    >
      MATH-255
    </span>
  );
}
