import {
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  ClipboardCheck,
  Eye,
  Flag,
  House,
  ListChecks,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * The single source of navigation for the shell. The header, the professor
 * rail and the phone menu all read from here, so a new destination is added
 * once.
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

// Professor words say where they lead: "Home" is the professor's start page,
// "Student view" opens the pages students use.
export const PROFESSOR_NAV: HeaderNavItem[] = [
  { href: "/professor", label: "Home" },
  { href: "/learn", label: "Student view" },
];

/**
 * Keys a caller can supply live counts for (`ProfessorRail counts`). Only
 * something that needs the professor gets a count: questions waiting for
 * review. Totals are never shown in the rail.
 */
export type WorkspaceCountKey = "review";

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

export type WorkspaceSectionGroup = {
  /** Small heading above the group ("Teach"). */
  heading: string;
  sections: WorkspaceSection[];
};

/**
 * Professor pages grouped by what the professor is trying to do. The page
 * name here is the same word used for the page's h1, breadcrumb and title.
 */
export const PROFESSOR_SECTION_GROUPS: WorkspaceSectionGroup[] = [
  {
    heading: "Teach",
    sections: [
      { href: "/professor", label: "Home", icon: House },
      {
        href: "/professor/review",
        label: "Review questions",
        icon: ClipboardCheck,
        countKey: "review",
      },
      { href: "/professor/questions", label: "Question bank", icon: ListChecks },
      {
        href: "/professor/availability",
        label: "What students see",
        icon: Eye,
      },
    ],
  },
  {
    heading: "Students",
    sections: [
      {
        href: "/professor/students",
        label: "Students",
        icon: Users,
        prefetch: false,
      },
      { href: "/professor/analytics", label: "Class progress", icon: BarChart3 },
      {
        href: "/professor/feedback",
        label: "Reports from students",
        icon: Flag,
      },
    ],
  },
  {
    heading: "Courses",
    sections: [{ href: "/professor/courses", label: "Courses", icon: BookOpen }],
  },
  {
    heading: "Less often",
    sections: [
      { href: "/professor/upload", label: "Upload notes", icon: Upload },
      {
        href: "/professor/content-transfer",
        label: "Copy questions in or out",
        icon: ArrowLeftRight,
      },
    ],
  },
];

/** Every professor page in rail order, for callers that need a flat list. */
export const PROFESSOR_SECTIONS: WorkspaceSection[] =
  PROFESSOR_SECTION_GROUPS.flatMap((group) => group.sections);

/** "12 waiting": the rail's count, in words. */
export function waitingCountLabel(count: number) {
  return `${count} waiting`;
}

/** Header words: a section is active anywhere below it ("/" only exactly). */
export function isNavActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Rail rows: "Home" (/professor) is active only on itself. */
export function isSectionActive(pathname: string, href: string) {
  if (href === "/professor") {
    return pathname === "/professor";
  }
  return isNavActive(pathname, href);
}
