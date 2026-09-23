"use client";

import Link from "next/link";
import { Search, Shuffle } from "lucide-react";
import { useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { nativeSelectClassName } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

export const LEARN_FILTERS = [
  "all",
  "unsolved",
  "hint-used",
  "retired",
] as const;

export type LearnFilter = (typeof LEARN_FILTERS)[number];

export const LEARN_SORTS = ["syllabus", "difficulty", "status"] as const;

export type LearnSort = (typeof LEARN_SORTS)[number];

const FILTER_LABELS: Record<LearnFilter, string> = {
  all: "All",
  unsolved: "Unsolved",
  "hint-used": "Hint used",
  retired: "Retired",
};

const SORT_LABELS: Record<LearnSort, string> = {
  syllabus: "Syllabus order",
  difficulty: "Difficulty",
  status: "Status",
};

export type LearnToolbarProps = {
  className?: string;
  filter: LearnFilter;
  onFilterChange: (filter: LearnFilter) => void;
  onSearchChange: (search: string) => void;
  onSortChange?: (sort: LearnSort) => void;
  search: string;
  searchLabel: string;
  searchPlaceholder: string;
  sort?: LearnSort;
  /** Every unsolved destination the shuffle button may land on. */
  unsolvedHrefs: string[];
};

/**
 * Search · sort · filter · shuffle, right-aligned above a list. The shuffle
 * button is a real link so it is keyboard-reachable and opens in a new tab
 * like any other: its target is the first unsolved question on the server and
 * a random one once the page is interactive, which keeps the server and the
 * first client render identical.
 */
export function LearnToolbar({
  className,
  filter,
  onFilterChange,
  onSearchChange,
  onSortChange,
  search,
  searchLabel,
  searchPlaceholder,
  sort,
  unsolvedHrefs,
}: LearnToolbarProps) {
  const searchId = useId();
  const filterId = useId();
  const sortId = useId();
  const [shuffleIndex, setShuffleIndex] = useState(0);

  // The target is re-drawn the moment the button is reached — on hover, on
  // focus, and again on press — rather than during render or in an effect, so
  // the server and the first client render agree and every activation lands
  // somewhere new.
  const reshuffle = () => {
    if (unsolvedHrefs.length > 1) {
      setShuffleIndex(Math.floor(Math.random() * unsolvedHrefs.length));
    }
  };

  const randomHref =
    unsolvedHrefs.length > 0
      ? unsolvedHrefs[shuffleIndex % unsolvedHrefs.length]
      : undefined;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="relative min-w-40 flex-1 sm:max-w-56">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <label className="sr-only" htmlFor={searchId}>
          {searchLabel}
        </label>
        <Input
          id={searchId}
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          className="h-9 rounded-[6px] pl-8"
        />
      </div>

      {sort && onSortChange ? (
        <>
          <label className="sr-only" htmlFor={sortId}>
            Sort questions
          </label>
          <select
            id={sortId}
            value={sort}
            onChange={(event) => onSortChange(event.target.value as LearnSort)}
            className={cn(nativeSelectClassName, "h-9 w-auto rounded-[6px]")}
          >
            {LEARN_SORTS.map((value) => (
              <option key={value} value={value}>
                {SORT_LABELS[value]}
              </option>
            ))}
          </select>
        </>
      ) : null}

      <label className="sr-only" htmlFor={filterId}>
        Filter
      </label>
      <select
        id={filterId}
        value={filter}
        onChange={(event) => onFilterChange(event.target.value as LearnFilter)}
        className={cn(nativeSelectClassName, "h-9 w-auto rounded-[6px]")}
      >
        {LEARN_FILTERS.map((value) => (
          <option key={value} value={value}>
            {FILTER_LABELS[value]}
          </option>
        ))}
      </select>

      {randomHref ? (
        <Link
          href={randomHref}
          onMouseEnter={reshuffle}
          onFocus={reshuffle}
          onPointerDown={reshuffle}
          aria-label="Open a random unsolved question"
          title="Random unsolved"
          className="inline-flex h-9 items-center gap-2 rounded-[6px] border border-input px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Shuffle aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">Random unsolved</span>
        </Link>
      ) : null}
    </div>
  );
}

/** The shared row filter behind both toolbars. */
export function matchesLearnFilter(
  row: { hintsUsed: number; status: string },
  filter: LearnFilter,
) {
  switch (filter) {
    case "unsolved":
      return row.status !== "done" && row.status !== "retired";
    case "hint-used":
      return row.hintsUsed > 0;
    case "retired":
      return row.status === "retired";
    case "all":
    default:
      return true;
  }
}
