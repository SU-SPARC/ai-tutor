import {
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  CalendarClock,
  ClipboardCheck,
  Flag,
  LayoutDashboard,
  ListChecks,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * The single source of navigation for the shell. The header, the professor
 * rail, the professor section strip and the phone menu all read from here, so
 * a new destination is added once.
 */

export type HeaderNavItem = {
  href: string;
  label: string;
  title?: string;
};

// Two nav words per role, no more. Everything else a student can reach is in
// the syllabus rail or the account menu.
export const STUDENT_NAV: HeaderNavItem[] = [
  { href: "/learn", label: "Learn" },
  { href: "/practice", label: "Practice" },
];

export const PROFESSOR_NAV: HeaderNavItem[] = [
  { href: "/professor", label: "Workspace" },
  { href: "/learn", label: "Learn", title: "View as student" },
];

/** Keys a caller can supply live counts for (`ProfessorRail counts`). */
export type WorkspaceCountKey =
  | "review"
  | "feedback"
  | "questions"
  | "students";

export type WorkspaceSection = {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * Rendering the Students page shows student usernames and records each
   * display, so that page is fetched only when the professor opens it.
   */
  prefetch?: false;
  countKey?: WorkspaceCountKey;
};

/**
 * Workspace sections in workflow order rather than alphabetical: what
 * arrives, what needs a decision, what has been decided, what students can
 * reach.
 */
export const PROFESSOR_SECTIONS: WorkspaceSection[] = [
  { href: "/professor", label: "Overview", icon: LayoutDashboard },
  { href: "/professor/courses", label: "Courses", icon: BookOpen },
  {
    href: "/professor/review",
    label: "Review queue",
    icon: ClipboardCheck,
    countKey: "review",
  },
  {
    href: "/professor/feedback",
    label: "Student reports",
    icon: Flag,
    countKey: "feedback",
  },
  {
    href: "/professor/questions",
    label: "Question lifecycle",
    icon: ListChecks,
    countKey: "questions",
  },
  {
    href: "/professor/availability",
    label: "Student availability",
    icon: CalendarClock,
  },
  {
    href: "/professor/students",
    label: "Students",
    icon: Users,
    prefetch: false,
    countKey: "students",
  },
  { href: "/professor/upload", label: "Uploads", icon: Upload },
  { href: "/professor/analytics", label: "Analytics", icon: BarChart3 },
];

/** Occasional administrative actions, kept apart from the workflow. */
export const PROFESSOR_ADMIN_SECTIONS: WorkspaceSection[] = [
  {
    href: "/professor/content-transfer",
    label: "Import & export",
    icon: ArrowLeftRight,
  },
];

/** Header words: a section is active anywhere below it ("/" only exactly). */
export function isNavActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Rail rows: "Overview" (/professor) is active only on itself. */
export function isSectionActive(pathname: string, href: string) {
  if (href === "/professor") {
    return pathname === "/professor";
  }
  return isNavActive(pathname, href);
}
