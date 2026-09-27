"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Check,
  Circle,
  CircleDot,
  CircleSlash,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import {
  PROFESSOR_ADMIN_SECTIONS,
  PROFESSOR_SECTIONS,
  isSectionActive,
  type WorkspaceCountKey,
  type WorkspaceSection,
} from "@/components/shell/nav-config";
import { MasteryPip } from "@/components/ui/mastery-chip";
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
  /** Right-hand text (mono): "3 of 8", "opens Sep 22". */
  meta?: string;
  /** Right-hand count (mono, tabular). Shown instead of `meta` when both set. */
  count?: number;
  active?: boolean;
  disabled?: boolean;
  /** Left column content that replaces the glyph (week number, icon). */
  leading?: ReactNode;
  /** Right column content after meta/count (a MasteryPip). */
  trailing?: ReactNode;
  /** Icon shown when the rail is collapsed to 48px. */
  icon?: LucideIcon;
  /** Short text shown when collapsed and there is no icon ("3"). */
  short?: string;
  /** "Up next": a left azure rule without the active wash. */
  current?: boolean;
  prefetch?: false;
  /** Tooltip / title attribute. Defaults to `label`. */
  title?: string;
};

export type AppRailProps = {
  /** Group label shown above the rows; also the nav's accessible name. */
  title?: string;
  /** Accessible name when `title` is not shown. */
  label?: string;
  items: RailItem[];
  footer?: ReactNode;
  className?: string;
};

// 40px rows (44 on touch), separated by nothing: the active row is the only
// one with a wash and a left rule, so the eye finds it without the rail
// turning into a table. Inside a collapsed ThreeColumn rail
// (`data-collapsed="true"`) rows shrink to their leading column.
const ROW_CLASSES =
  "flex min-h-10 w-full items-center gap-2.5 border-l-2 py-2 pr-3 pl-3 text-base transition-colors duration-fast ease-out pointer-coarse:min-h-11 group-data-[collapsed=true]/rail:justify-center group-data-[collapsed=true]/rail:px-0";

const COLLAPSED_HIDDEN = "group-data-[collapsed=true]/rail:sr-only";

function RailGlyphIcon({ glyph }: { glyph: RailGlyph }) {
  const className = "size-4 shrink-0";

  switch (glyph) {
    case "none":
      return <span aria-hidden="true" className={className} />;
    case "done":
      return (
        <span
          aria-hidden="true"
          className={cn(
            className,
            "inline-flex items-center justify-center rounded-full bg-green-500 text-on-fill",
          )}
        >
          <Check className="size-3" strokeWidth={3} />
        </span>
      );
    case "current":
      return (
        <CircleDot
          aria-hidden="true"
          className={cn(className, "text-azure-500")}
        />
      );
    case "retired":
      return (
        <CircleSlash
          aria-hidden="true"
          className={cn(className, "text-ink-muted")}
        />
      );
    case "closed":
    case "todo":
    default:
      return (
        <Circle
          aria-hidden="true"
          className={cn(className, "text-ink-muted")}
        />
      );
  }
}

/**
 * One dense vertical list, several contents: the syllabus for a student, the
 * workspace sections for a professor, the questions of a topic in practice.
 *
 * A closed row (a topic the section has not opened yet) is deliberately NOT a
 * link: the "opens Sep 22" meta says why, and it is not a tab stop.
 */
export function AppRail({
  title,
  label,
  items,
  footer,
  className,
}: AppRailProps) {
  return (
    <nav
      aria-label={label ?? title ?? "Sections"}
      className={cn("flex flex-col gap-1", className)}
      data-slot="app-rail"
    >
      {title ? (
        <p className={cn("type-label px-4 pb-1", COLLAPSED_HIDDEN)}>{title}</p>
      ) : null}

      <RailList items={items} />

      {footer ? (
        <div className={cn("px-4 pt-2", COLLAPSED_HIDDEN)}>{footer}</div>
      ) : null}
    </nav>
  );
}

function RailList({ items }: { items: RailItem[] }) {
  return (
    <ul className="flex flex-col">
      {items.map((item) => {
        const glyph = item.glyph ?? "none";
        const inert = item.disabled || glyph === "closed";
        const Icon = item.icon;
        const leading =
          item.leading ??
          (Icon ? (
            <Icon
              aria-hidden="true"
              className="size-4 shrink-0 text-ink-muted"
            />
          ) : glyph !== "none" || !item.short ? (
            <RailGlyphIcon glyph={glyph} />
          ) : null);
        const right =
          item.count !== undefined ? (
            <span className="font-mono text-sm tabular text-ink-muted">
              {item.count}
            </span>
          ) : item.meta ? (
            <span className="font-mono text-sm text-ink-muted">
              {item.meta}
            </span>
          ) : null;

        const content = (
          <>
            {leading}
            {item.short && !item.icon ? (
              <span
                aria-hidden="true"
                className="hidden font-mono text-sm group-data-[collapsed=true]/rail:inline"
              >
                {item.short}
              </span>
            ) : null}
            <span className={cn("min-w-0 flex-1 truncate", COLLAPSED_HIDDEN)}>
              {item.label}
            </span>
            {right || item.trailing ? (
              <span
                className={cn(
                  "ml-auto flex shrink-0 items-center gap-2",
                  "group-data-[collapsed=true]/rail:hidden",
                )}
              >
                {right}
                {item.trailing}
              </span>
            ) : null}
          </>
        );

        return (
          <li key={item.href}>
            {inert ? (
              <span
                title={item.title ?? item.label}
                className={cn(
                  ROW_CLASSES,
                  "cursor-default border-transparent text-ink-muted",
                )}
              >
                {content}
              </span>
            ) : (
              <Link
                href={item.href}
                prefetch={item.prefetch}
                title={item.title ?? item.label}
                aria-current={item.active ? "page" : undefined}
                className={cn(
                  ROW_CLASSES,
                  "focus-ring -outline-offset-2",
                  item.active
                    ? "border-azure-500 bg-azure-100 font-medium text-azure-700"
                    : item.current
                      ? "border-azure-500 text-ink hover:bg-hover"
                      : "border-transparent text-ink hover:bg-hover",
                )}
              >
                {content}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export type ProfessorRailCounts = Partial<Record<WorkspaceCountKey, number>>;

function sectionItems(
  sections: WorkspaceSection[],
  pathname: string,
  counts: ProfessorRailCounts | undefined,
): RailItem[] {
  return sections.map((section) => ({
    href: section.href,
    label: section.label,
    icon: section.icon,
    prefetch: section.prefetch,
    count: section.countKey ? counts?.[section.countKey] : undefined,
    active: isSectionActive(pathname, section.href),
  }));
}

/**
 * The professor workspace rail: every section from `nav-config`, with a live
 * count on the right where the layout could load one ("Review queue 264").
 */
export function ProfessorRail({
  footer,
  className,
  counts,
}: {
  footer?: ReactNode;
  className?: string;
  counts?: ProfessorRailCounts;
}) {
  const pathname = usePathname() ?? "/professor";

  return (
    <nav
      aria-label="Workspace"
      data-slot="app-rail"
      className={cn("flex flex-col gap-1", className)}
    >
      <p className={cn("type-label px-4 pb-1", COLLAPSED_HIDDEN)}>Workspace</p>
      <RailList items={sectionItems(PROFESSOR_SECTIONS, pathname, counts)} />
      <hr className="mx-4 my-2 border-rule group-data-[collapsed=true]/rail:mx-2" />
      <RailList
        items={sectionItems(PROFESSOR_ADMIN_SECTIONS, pathname, counts)}
      />
      {footer ? (
        <div className={cn("px-4 pt-2", COLLAPSED_HIDDEN)}>{footer}</div>
      ) : null}
    </nav>
  );
}

export type SyllabusRailTopic = {
  id: string;
  weekNumber: number;
  title: string;
  href: string;
  glyph: RailGlyph;
  meta?: string;
  /** 0-4. When set, a MasteryPip replaces the glyph. */
  masteryLevel?: number;
  /** "Up next": left azure rule. */
  current?: boolean;
};

export type SyllabusRailProps = {
  topics: SyllabusRailTopic[];
  activeTopicId?: string;
  footer?: ReactNode;
  className?: string;
};

/** "Wk 3 · Conditional Probability": the row's full name (title attribute). */
export function syllabusRowLabel(weekNumber: number, title: string) {
  return `Wk ${weekNumber} · ${title}`;
}

/**
 * The syllabus: week (mono) + title + mastery pip per row. The active topic
 * gets the azure wash; the "up next" topic a left azure rule.
 */
export function SyllabusRail({
  topics,
  activeTopicId,
  footer,
  className,
}: SyllabusRailProps) {
  const items: RailItem[] = topics.map((topic) => ({
    href: topic.href,
    label: topic.title,
    title: syllabusRowLabel(topic.weekNumber, topic.title),
    glyph: topic.glyph,
    meta: topic.meta,
    short: String(topic.weekNumber),
    current: topic.current,
    leading: (
      <span
        className={cn(
          "w-7 shrink-0 font-mono text-sm tabular text-ink-muted",
          "group-data-[collapsed=true]/rail:hidden",
        )}
      >
        <span className="sr-only">Week </span>
        {topic.weekNumber}
      </span>
    ),
    trailing:
      topic.masteryLevel !== undefined ? (
        <MasteryPip level={topic.masteryLevel} />
      ) : (
        <RailGlyphIcon glyph={topic.glyph} />
      ),
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
