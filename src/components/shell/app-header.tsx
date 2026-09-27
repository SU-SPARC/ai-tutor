import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { CourseSwitcher } from "@/components/courses/course-switcher";
import { MobileNav } from "@/components/shell/mobile-nav";
import { NavLink } from "@/components/shell/nav-link";
import { PROFESSOR_NAV, STUDENT_NAV } from "@/components/shell/nav-config";
import { StudentSectionChip } from "@/components/shell/student-section-chip";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

export type AppHeaderRole = "student" | "professor";

export type AppHeaderProps = {
  /** The account control (AccountActions): a menu when signed in. */
  accountControl?: ReactNode;
  /**
   * Non-production indicator. No longer drawn in the bar: it is a line in the
   * phone menu here, and AccountActions shows it in the account menu.
   */
  environmentLabel?: "Development" | "Local demo" | "Preview" | "Preview demo";
  role?: AppHeaderRole;
  className?: string;
};

/**
 * The one header for both roles. `--header-h` (56px) tall at every width, no
 * border, a 1px brand-gradient hairline below. It never wraps: below 1024 the
 * nav words and theme control move into the menu sheet.
 *
 * Desktop: wordmark · course/section chip · nav words … theme · account.
 * Phone:   logo · chip … account · menu.
 *
 * A server component: the role comes from the root layout; only the nav
 * links, chip, theme control, account disclosure and menu are client islands.
 */
export function AppHeader({
  accountControl,
  environmentLabel,
  role,
  className,
}: AppHeaderProps) {
  const navItems = role === "professor" ? PROFESSOR_NAV : STUDENT_NAV;

  return (
    <header
      data-slot="app-header"
      className={cn("sticky top-0 z-40 bg-surface", className)}
    >
      <div className="mx-auto flex h-(--header-h) w-full max-w-[90rem] items-center gap-2 px-3 sm:gap-4 sm:px-6">
        <Link
          href="/"
          aria-label="ProbStat Tutor home"
          className="flex shrink-0 items-center gap-2.5 rounded-control p-1 focus-ring"
        >
          <Image
            src="/logo.png"
            alt=""
            width={28}
            height={28}
            priority
            className="size-7"
          />
          <span className="hidden font-display text-lg leading-none font-medium text-ink sm:inline">
            ProbStat Tutor
          </span>
        </Link>

        <div className="flex min-w-0 items-center">
          {role === "professor" ? (
            <>
              {/* The switcher renders nothing outside the courses store, so the
               * fallback chip stands in; `:only-child` picks whichever one
               * actually made it into the DOM. */}
              <CourseSwitcher />
              <FallbackCourseChip className="[&:not(:only-child)]:hidden" />
            </>
          ) : (
            <StudentSectionChip />
          )}
        </div>

        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {navItems.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              title={item.title}
            />
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <ThemeToggle className="hidden lg:inline-flex" />
          {accountControl}
          <MobileNav role={role} environmentLabel={environmentLabel} />
        </div>
      </div>

      <div aria-hidden="true" className="gradient-hairline w-full" />
    </header>
  );
}

function FallbackCourseChip({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-8 w-fit shrink-0 items-center rounded-control bg-surface-tint px-2.5 font-mono text-sm text-ink",
        className,
      )}
    >
      MATH-255
    </span>
  );
}
