"use client";

/**
 * The practice rail: this topic's questions as one dense column, with the same
 * ✓ ● ○ glyph vocabulary the syllabus rail uses, a topic switcher above it, and
 * exactly one button — "Next new →".
 *
 * Rows are real links to `/practice/<questionId>` so the rail works without
 * JavaScript and so middle-click / open-in-new-tab behave, but a capture-phase
 * click handler turns an ordinary click into the workspace's in-page
 * `selectQuestion`, which keeps the loaded session, transcript, and hints.
 */

import {
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleDot,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import type { MouseEvent } from "react";

import {
  AppRail,
  type RailGlyph,
  type RailItem,
} from "@/components/shell/app-rail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

/** The search box only earns its 40px once the list stops fitting on a screen. */
export const RAIL_SEARCH_THRESHOLD = 8;

export type PracticeRailQuestion = {
  id: string;
  title: string;
};

export type PracticeRailTopic = {
  id: string;
  title: string;
};

export function practiceQuestionHref(questionId: string) {
  return `/practice/${encodeURIComponent(questionId)}`;
}

/** "WK 3" — mono, because a week number is a value, not a sentence. */
export function practiceWeekLabel(weekNumber?: number) {
  return typeof weekNumber === "number" && weekNumber > 0
    ? `WK ${weekNumber}`
    : "PRACTICE";
}

export function practiceRailGlyph({
  selected,
  solved,
}: {
  selected: boolean;
  solved: boolean;
}): RailGlyph {
  if (solved) return "done";
  return selected ? "current" : "todo";
}

function questionIdFromHref(href: string | null) {
  if (!href) return undefined;
  const match = /^\/practice\/([^/?#]+)$/.exec(href);
  return match ? decodeURIComponent(match[1]) : undefined;
}

type PracticeRailProps = {
  collapsed: boolean;
  disabled?: boolean;
  nextQuestionId?: string;
  onNextNew: () => void;
  onSearchChange: (value: string) => void;
  onSelectQuestion: (questionId: string) => void;
  onSelectTopic: (topicId: string) => void;
  onToggleCollapsed: () => void;
  /** Retained topic-tree state; the select replaced the tree, not the state. */
  openTopicCount?: number;
  questions: PracticeRailQuestion[];
  search: string;
  selectedQuestionId?: string;
  selectedTopicId: string;
  solvedQuestionIds: ReadonlySet<string>;
  topics: PracticeRailTopic[];
  weekLabel: string;
};

export function PracticeRail({
  collapsed,
  disabled = false,
  nextQuestionId,
  onNextNew,
  onSearchChange,
  onSelectQuestion,
  onSelectTopic,
  onToggleCollapsed,
  openTopicCount,
  questions,
  search,
  selectedQuestionId,
  selectedTopicId,
  solvedQuestionIds,
  topics,
  weekLabel,
}: PracticeRailProps) {
  const query = search.trim().toLowerCase();
  const rows = questions
    .map((question, index) => ({ position: index + 1, question }))
    .filter(({ question }) =>
      query.length === 0 ? true : question.title.toLowerCase().includes(query),
    );

  function handleRowClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const target = event.target as HTMLElement | null;
    const anchor = target?.closest?.("a[href]") ?? null;
    const questionId = questionIdFromHref(anchor?.getAttribute("href") ?? null);
    if (!questionId) {
      return;
    }
    // Keep the loaded session instead of re-entering the route.
    event.preventDefault();
    if (disabled) {
      return;
    }
    onSelectQuestion(questionId);
  }

  if (collapsed) {
    return (
      <div
        className="flex w-12 flex-col items-center gap-1"
        data-slot="practice-rail"
        data-collapsed="true"
        data-open-topics={openTopicCount}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Expand the question list"
          aria-expanded={false}
          onClick={onToggleCollapsed}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
        <div
          className="flex w-full flex-col items-center gap-0.5"
          onClickCapture={handleRowClickCapture}
        >
          {rows.map(({ position, question }) => {
            const solved = solvedQuestionIds.has(question.id);
            const selected = question.id === selectedQuestionId;
            return (
              <Link
                key={question.id}
                href={practiceQuestionHref(question.id)}
                title={`${position}. ${question.title}`}
                aria-label={`${position}. ${question.title}`}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "flex size-8 items-center justify-center rounded-[6px] border-l-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  selected
                    ? "border-primary bg-indigo-100 text-primary"
                    : "border-transparent text-muted-foreground hover:bg-accent",
                )}
              >
                <CollapsedGlyph selected={selected} solved={solved} />
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  const items: RailItem[] = rows.map(({ position, question }) => ({
    active: question.id === selectedQuestionId,
    glyph: practiceRailGlyph({
      selected: question.id === selectedQuestionId,
      solved: solvedQuestionIds.has(question.id),
    }),
    href: practiceQuestionHref(question.id),
    label: question.title,
    meta: String(position),
  }));

  return (
    <div
      className="flex flex-col gap-3"
      data-slot="practice-rail"
      data-open-topics={openTopicCount}
    >
      <div className="flex items-center gap-2 px-3">
        <p className="min-w-0 flex-1 truncate font-mono text-xs tracking-wide text-muted-foreground">
          {weekLabel}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label="Collapse the question list"
          aria-expanded
          onClick={onToggleCollapsed}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="px-3">
        <label className="sr-only" htmlFor="practice-rail-topic">
          Topic
        </label>
        <NativeSelect
          id="practice-rail-topic"
          className="h-9 rounded-[6px] text-sm"
          value={selectedTopicId}
          disabled={disabled || topics.length === 0}
          onChange={(event) => onSelectTopic(event.target.value)}
        >
          {topics.map((topic) => (
            <option key={topic.id} value={topic.id}>
              {topic.title}
            </option>
          ))}
        </NativeSelect>
      </div>

      {questions.length > RAIL_SEARCH_THRESHOLD ? (
        <div className="relative px-3">
          <Search
            className="pointer-events-none absolute top-1/2 left-5.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search problems…"
            aria-label="Search problems"
            className="h-9 rounded-[6px] px-8"
          />
          {search ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onSearchChange("")}
              className="absolute top-1/2 right-5 -translate-y-1/2 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}

      {items.length > 0 ? (
        <div onClickCapture={handleRowClickCapture}>
          {/* The visible week label lives in the header row above (mono, next
              to the collapse control), so AppRail's own title is hidden — it
              is passed only because AppRail derives the nav's accessible name
              from it, and "Sections" would be the wrong name for a list of
              questions. */}
          <AppRail className="[&>p]:hidden" items={items} title={weekLabel} />
        </div>
      ) : (
        <p className="px-3 text-sm text-muted-foreground">
          {search.trim().length > 0
            ? `No matches for “${search.trim()}”.`
            : "No practice questions yet."}
        </p>
      )}

      {nextQuestionId ? (
        <div className="px-3 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full justify-between rounded-[6px]"
            disabled={disabled}
            onClick={onNextNew}
          >
            Next new
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The collapsed rail keeps only the glyph column. `AppRail` owns the expanded
 * row (label, meta, selected rule); it has no glyph-only mode, so the three
 * glyphs are repeated here rather than by editing the shared shell component.
 */
function CollapsedGlyph({
  selected,
  solved,
}: {
  selected: boolean;
  solved: boolean;
}) {
  if (solved) {
    return (
      <span
        aria-hidden="true"
        className="inline-flex size-4 items-center justify-center rounded-full bg-success text-success-foreground"
      >
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  }
  if (selected) {
    return <CircleDot aria-hidden="true" className="size-4 text-primary" />;
  }
  return <Circle aria-hidden="true" className="size-4 text-muted-foreground" />;
}
