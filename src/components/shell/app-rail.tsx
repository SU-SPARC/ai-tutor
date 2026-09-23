"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, Circle, CircleDot, CircleSlash } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type RailGlyph =
  | "done"
  | "current"
  | "todo"
  | "closed"
  | "retired"
  | "none";

export type RailItem = {
  href: string;
  label: string;
  glyph?: RailGlyph;
  meta?: string;
  active?: boolean;
  disabled?: boolean;
};

export type AppRailProps = {
  title?: string;
  items: RailItem[];
  footer?: ReactNode;
  className?: string;
};

const ROW_CLASSES =
  "flex w-full items-center gap-2 border-l-2 px-3 py-1.5 text-sm transition-colors";

function RailGlyphIcon({ glyph }: { glyph: RailGlyph }) {
  if (glyph === "none") {
    return <span aria-hidden="true" className="size-4 shrink-0" />;
  }

  const className = "size-4 shrink-0";

  switch (glyph) {
    case "done":
      return (
        <span
          aria-hidden="true"
          className={cn(
            className,
            "inline-flex items-center justify-center rounded-full bg-success text-success-foreground",
          )}
        >
          <Check className="size-3" strokeWidth={3} />
        </span>
      );
    case "current":
      return (
        <CircleDot
          aria-hidden="true"
          className={cn(className, "text-primary")}
        />
      );
    case "retired":
      return (
        <CircleSlash
          aria-hidden="true"
          className={cn(className, "text-muted-foreground")}
        />
      );
    case "closed":
      return (
        <Circle
          aria-hidden="true"
          className={cn(className, "text-muted-foreground opacity-60")}
        />
      );
    case "todo":
    default:
      return (
        <Circle
          aria-hidden="true"
          className={cn(className, "text-muted-foreground")}
        />
      );
  }
}

/**
 * One dense vertical list, two contents: the syllabus for a student, the
 * section list for a professor. Rows are 12px tall and separate by tint, not
 * by a rule — the selected row is the only one with a border, on its left
 * edge, so the eye finds it without the rail turning into a table.
 *
 * A closed row (a topic the section has not opened yet) is deliberately NOT a
 * link and carries no lock icon: the "opens Sep 22" meta says everything, and
 * a disabled anchor would still be reachable by keyboard.
 */
export function AppRail({ title, items, footer, className }: AppRailProps) {
  return (
    <nav
      aria-label={title ?? "Sections"}
      className={cn("flex flex-col gap-1", className)}
      data-slot="app-rail"
    >
      {title ? (
        <p className="px-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </p>
      ) : null}

      <ul className="flex flex-col">
        {items.map((item) => {
          const glyph = item.glyph ?? "none";
          const inert = item.disabled || glyph === "closed";
          const content = (
            <>
              <RailGlyphIcon glyph={glyph} />
              <span className="truncate">{item.label}</span>
              {item.meta ? (
                <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                  {item.meta}
                </span>
              ) : null}
            </>
          );

          return (
            <li key={item.href}>
              {inert ? (
                <span
                  aria-disabled="true"
                  title={item.label}
                  className={cn(
                    ROW_CLASSES,
                    "cursor-default border-transparent text-muted-foreground",
                  )}
                >
                  {content}
                </span>
              ) : (
                <Link
                  href={item.href}
                  title={item.label}
                  aria-current={item.active ? "page" : undefined}
                  className={cn(
                    ROW_CLASSES,
                    "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    item.active
                      ? "border-primary bg-indigo-100 font-medium text-primary"
                      : "border-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ul>

      {footer ? <div className="px-3 pt-2">{footer}</div> : null}
    </nav>
  );
}

type ProfessorSection = {
  href: string;
  label: string;
};

/**
 * The professor sections, in workflow order rather than alphabetical: what
 * arrives, what needs a decision, what has been decided, what students can
 * reach. Import/export sits after a separator — it is an occasional
 * administrative action, not a stop in the review workflow.
 */
const PROFESSOR_SECTIONS: ProfessorSection[] = [
  { href: "/professor", label: "Overview" },
  { href: "/professor/courses", label: "Courses" },
  { href: "/professor/review", label: "Review queue" },
  { href: "/professor/feedback", label: "Student reports" },
  { href: "/professor/questions", label: "Question lifecycle" },
  { href: "/professor/availability", label: "Student availability" },
  { href: "/professor/students", label: "Students" },
  { href: "/professor/upload", label: "Uploads" },
  { href: "/professor/analytics", label: "Analytics" },
];

const PROFESSOR_TRANSFER: ProfessorSection = {
  href: "/professor/content-transfer",
  label: "Import & export",
};

function isActive(pathname: string, href: string) {
  if (href === "/professor") {
    return pathname === "/professor";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ProfessorRail({
  footer,
  className,
}: {
  footer?: ReactNode;
  className?: string;
}) {
  const pathname = usePathname() ?? "/professor";

  const items: RailItem[] = PROFESSOR_SECTIONS.map((section) => ({
    href: section.href,
    label: section.label,
    active: isActive(pathname, section.href),
  }));

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <AppRail title="Workspace" items={items} />
      <hr className="mx-3 border-border" />
      <AppRail
        items={[
          {
            href: PROFESSOR_TRANSFER.href,
            label: PROFESSOR_TRANSFER.label,
            active: isActive(pathname, PROFESSOR_TRANSFER.href),
          },
        ]}
        footer={footer}
      />
    </div>
  );
}

export type SyllabusRailTopic = {
  id: string;
  weekNumber: number;
  title: string;
  href: string;
  glyph: RailGlyph;
  meta?: string;
};

export type SyllabusRailProps = {
  topics: SyllabusRailTopic[];
  activeTopicId?: string;
  footer?: ReactNode;
  className?: string;
};

export function syllabusRowLabel(weekNumber: number, title: string) {
  return `Wk${weekNumber} · ${title}`;
}

export function SyllabusRail({
  topics,
  activeTopicId,
  footer,
  className,
}: SyllabusRailProps) {
  const items: RailItem[] = topics.map((topic) => ({
    href: topic.href,
    label: syllabusRowLabel(topic.weekNumber, topic.title),
    glyph: topic.glyph,
    meta: topic.meta,
    active: topic.id === activeTopicId,
  }));

  return (
    <AppRail
      title="Syllabus"
      items={items}
      footer={footer}
      className={className}
    />
  );
}
