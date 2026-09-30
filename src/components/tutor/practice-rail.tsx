"use client";

/**
 * The practice rail: this topic's questions as one dense column, with the same
 * ✓ ● ○ glyph vocabulary the syllabus rail uses, a topic switcher above it, and
 * exactly one button — "Next unsolved".
 *
 * Rows are real links to `/practice/<questionId>` so the rail works without
 * JavaScript and so middle-click / open-in-new-tab behave, but a capture-phase
 * click handler turns an ordinary click into the workspace's in-page
 * `selectQuestion`, which keeps the loaded session, transcript, and hints (and
 * rewrites the address bar to the same URL).
 *
 * Collapsed (48px), the same AppRail rows shrink to their glyph; the collapse
 * control stays the same element in both states, so focus never drops.
 */

import {
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleDot,
  PanelLeftClose,
  PanelLeftOpen,
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

/** "Week 3": the week in words (never "Wk"). */
export function practiceWeekLabel(weekNumber?: number) {
  return typeof weekNumber === "number" && weekNumber > 0
    ? `Week ${weekNumber}`
    : "Practice";
}

/** The one mapping from a question's state to its glyph (rail and footer). */
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

/**
 * The glyph itself, for places outside AppRail (the footer pips). Same shapes
 * and colours as AppRail's rows: filled green check, azure dot, hollow ring.
 */
export function PracticeGlyph({
  glyph,
  className,
}: {
  glyph: RailGlyph;
  className?: string;
}) {
  if (glyph === "done") {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-green-500 text-on-fill",
          className,
        )}
      >
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  }
  if (glyph === "current") {
    return (
      <CircleDot
        aria-hidden="true"
        className={cn("size-4 shrink-0 text-azure-500", className)}
      />
    );
  }
  return (
    <Circle
      aria-hidden="true"
      className={cn("size-4 shrink-0 text-ink-muted", className)}
    />
  );
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
  /** Skips to the first unsolved question in the topic. */
  onNextUnsolved: () => void;
  onSearchChange: (value: string) => void;
  onSelectQuestion: (questionId: string) => void;
  onSelectTopic: (topicId: string) => void;
  onToggleCollapsed: () => void;
  questions: PracticeRailQuestion[];
  search: string;
  selectedQuestionId?: string;
  selectedTopicId: string;
  solvedQuestionIds: ReadonlySet<string>;
  /** The topic's overview page, the rail's way back out of practice. */
  topicHref: string;
  topicTitle?: string;
  topics: PracticeRailTopic[];
  weekLabel: string;
};

export function PracticeRail({
  collapsed,
  disabled = false,
  nextQuestionId,
  onNextUnsolved,
  onSearchChange,
  onSelectQuestion,
  onSelectTopic,
  onToggleCollapsed,
  questions,
  search,
  selectedQuestionId,
  selectedTopicId,
  solvedQuestionIds,
  topicHref,
  topicTitle,
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

  const items: RailItem[] = rows.map(({ position, question }) => ({
    active: question.id === selectedQuestionId,
    glyph: practiceRailGlyph({
      selected: question.id === selectedQuestionId,
      solved: solvedQuestionIds.has(question.id),
    }),
    href: practiceQuestionHref(question.id),
    label: question.title,
    meta: String(position),
    title: `${position}. ${question.title}${
      solvedQuestionIds.has(question.id) ? " (solved)" : ""
    }`,
  }));

  return (
    <div
      className="flex flex-col gap-4"
      data-slot="practice-rail"
      data-collapsed={collapsed ? "true" : undefined}
    >
      <div
        className={cn(
          "flex items-center gap-1",
          collapsed ? "justify-center" : "pr-2 pl-3",
        )}
      >
        {collapsed ? null : (
          <Link
            href={topicHref}
            className="flex min-h-11 min-w-0 flex-1 items-start gap-1 rounded-control py-1 pr-2 pl-1 text-ink transition-colors duration-fast hover:bg-hover focus-ring"
          >
            <ChevronLeft
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
            />
            <span className="flex min-w-0 flex-col">
              <span className="type-body-strong truncate">
                {topicTitle ?? "Topic overview"}
              </span>
              <span className="type-caption">{weekLabel}</span>
            </span>
          </Link>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={
            collapsed
              ? "Expand the question list"
              : "Collapse the question list"
          }
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden="true" />
          ) : (
            <PanelLeftClose aria-hidden="true" />
          )}
        </Button>
      </div>

      {collapsed ? null : (
        <div className="flex flex-col gap-1.5 px-3">
          <label className="type-label" htmlFor="practice-rail-topic">
            Topic
          </label>
          <NativeSelect
            id="practice-rail-topic"
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
      )}

      {!collapsed && questions.length > RAIL_SEARCH_THRESHOLD ? (
        <div className="relative px-3">
          <Search
            className="pointer-events-none absolute top-1/2 left-6 size-4 -translate-y-1/2 text-ink-muted"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search questions…"
            aria-label="Search questions"
            className="pr-10 pl-9"
          />
          {search ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Clear search"
              onClick={() => onSearchChange("")}
              className="absolute top-1/2 right-4 -translate-y-1/2"
            >
              <X aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      ) : null}

      {items.length > 0 ? (
        <div onClickCapture={handleRowClickCapture}>
          <AppRail items={items} title="Questions" label="Question list" />
        </div>
      ) : collapsed ? null : (
        <p className="type-small px-4 text-ink-muted">
          {search.trim().length > 0
            ? `No questions match “${search.trim()}”.`
            : "No practice questions yet."}
        </p>
      )}

      {nextQuestionId && !collapsed ? (
        <div className="px-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full justify-between pointer-coarse:h-11"
            disabled={disabled}
            onClick={onNextUnsolved}
          >
            Next unsolved
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
