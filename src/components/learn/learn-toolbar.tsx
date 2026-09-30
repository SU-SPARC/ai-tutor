"use client";

import Link from "next/link";
import { Search, Shuffle } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
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
  retired: "No longer available",
};

const SORT_LABELS: Record<LearnSort, string> = {
  syllabus: "Syllabus order",
  difficulty: "Difficulty",
  status: "Status",
};

export type LearnToolbarProps = {
  className?: string;
  /** Omit (with `onFilterChange`) for a search-only toolbar. */
  filter?: LearnFilter;
  /** Accessible name of the filter select ("Filter topics"). */
  filterLabel?: string;
  onFilterChange?: (filter: LearnFilter) => void;
  onSearchChange: (search: string) => void;
  onSortChange?: (sort: LearnSort) => void;
  search: string;
  searchLabel: string;
  searchPlaceholder: string;
  sort?: LearnSort;
  /**
   * Offer "No longer available" in the filter only when the list has a
   * question your professor removed.
   */
  showRemovedFilter?: boolean;
  /** Every unsolved destination "Random question" may land on; omit for none. */
  unsolvedHrefs?: string[];
};

/**
 * Search · sort · filter · "Random question" above a list, wrapping when the
 * column is narrow (the search takes its own row on phones). Pages render it
 * only when a list is long enough to need it; `/learn` uses search alone.
 * Every control is 40px, 44px on touch. "Random question" (visible text at
 * every width) is a real link so it is keyboard-reachable and opens in a new tab
 * like any other: its target is the first unsolved question on the server and
 * a random one once the page is interactive, which keeps the server and the
 * first client render identical.
 */
export function LearnToolbar({
  className,
  filter,
  filterLabel = "Filter",
  onFilterChange,
  onSearchChange,
  onSortChange,
  search,
  searchLabel,
  searchPlaceholder,
  showRemovedFilter = false,
  sort,
  unsolvedHrefs = [],
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
      <div className="relative w-full sm:w-56 sm:shrink-0">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
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
          autoComplete="off"
          className="pl-9"
        />
      </div>

      {sort && onSortChange ? (
        <>
          <label className="sr-only" htmlFor={sortId}>
            Sort questions
          </label>
          <NativeSelect
            id={sortId}
            value={sort}
            onChange={(event) => onSortChange(event.target.value as LearnSort)}
            className="w-auto min-w-0 flex-1 sm:flex-none"
          >
            {LEARN_SORTS.map((value) => (
              <option key={value} value={value}>
                {SORT_LABELS[value]}
              </option>
            ))}
          </NativeSelect>
        </>
      ) : null}

      {filter && onFilterChange ? (
        <>
          <label className="sr-only" htmlFor={filterId}>
            {filterLabel}
          </label>
          <NativeSelect
            id={filterId}
            value={filter}
            onChange={(event) =>
              onFilterChange(event.target.value as LearnFilter)
            }
            className="w-auto min-w-0 flex-1 sm:flex-none"
          >
            {LEARN_FILTERS.filter(
              (value) =>
                value !== "retired" || showRemovedFilter || filter === value,
            ).map((value) => (
              <option key={value} value={value}>
                {FILTER_LABELS[value]}
              </option>
            ))}
          </NativeSelect>
        </>
      ) : null}

      {randomHref ? (
        <Button
          asChild
          variant="outline"
          className="shrink-0 px-3 pointer-coarse:h-11 sm:px-4"
        >
          <Link
            href={randomHref}
            onMouseEnter={reshuffle}
            onFocus={reshuffle}
            onPointerDown={reshuffle}
            title="Open a random unsolved question"
          >
            <Shuffle aria-hidden="true" />
            Random question
          </Link>
        </Button>
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
