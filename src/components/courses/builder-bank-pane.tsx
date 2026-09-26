"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, Plus, Search } from "lucide-react";

import { BankQuestionRow } from "@/components/courses/bank-question-row";
import type { BuilderGroup } from "@/components/courses/builder-released-pane";
import type { StagedChanges } from "@/components/courses/use-staged-changes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { courseTopicPath } from "@/lib/courses/paths";
import { cn } from "@/lib/utils";
import type {
  BankQuestion,
  CourseId,
  QuestionId,
  TopicId,
} from "@/lib/courses/types";

type BankFilter =
  | "all"
  | "published"
  | "approved_not_released"
  | "needs_review"
  | "draft";

const FILTERS: { id: BankFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "published", label: "Published" },
  { id: "approved_not_released", label: "Approved" },
  { id: "needs_review", label: "Needs review" },
  { id: "draft", label: "Draft" },
];

function matchesFilter(
  question: BankQuestion,
  filter: BankFilter,
  released: boolean,
) {
  switch (filter) {
    case "all":
      return true;
    case "published":
      return question.state === "published";
    case "approved_not_released":
      // Approved is by definition not yet releasable, so "not released" is the
      // honest reading of the filter: it can't be out there, and here is why.
      return question.state === "approved" && !released;
    case "needs_review":
      return question.state === "needs_review";
    case "draft":
      return question.state === "draft";
    default:
      return true;
  }
}

function matchesSearch(question: BankQuestion, needle: string) {
  if (needle.length === 0) {
    return true;
  }
  return (
    question.title.toLowerCase().includes(needle) ||
    question.prompt.toLowerCase().includes(needle) ||
    question.id.toLowerCase().includes(needle) ||
    question.tags.some((tag) => tag.toLowerCase().includes(needle))
  );
}

/**
 * The right pane: the whole bank for the course's topics, grouped by topic
 * (Teachable's curriculum pattern), with a state chip per row and ⊕ / ⊖ to
 * stage a change. Rows that cannot be released say why, as a link to the step
 * that unblocks them.
 */
export function BuilderBankPane({
  courseId,
  groups,
  onCollapseAll,
  onExpandAll,
  onSetTopicOpen,
  onStageToggle,
  openTopics,
  releasedIds,
  sectionLabel,
  staged,
}: {
  courseId: CourseId;
  groups: BuilderGroup[];
  onCollapseAll: () => void;
  onExpandAll: () => void;
  onSetTopicOpen: (topicId: TopicId, open: boolean) => void;
  onStageToggle: (questionId: QuestionId) => void;
  openTopics: ReadonlySet<TopicId>;
  /** Questions this section already has a row for (released or held). */
  releasedIds: ReadonlySet<QuestionId>;
  sectionLabel: string;
  staged: StagedChanges;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<BankFilter>("all");
  const needle = search.trim().toLowerCase();

  const filterCounts = useMemo(() => {
    const counts: Record<BankFilter, number> = {
      all: 0,
      published: 0,
      approved_not_released: 0,
      needs_review: 0,
      draft: 0,
    };
    for (const group of groups) {
      for (const question of group.bank) {
        const released = releasedIds.has(question.id);
        for (const entry of FILTERS) {
          if (matchesFilter(question, entry.id, released)) {
            counts[entry.id] += 1;
          }
        }
      }
    }
    return counts;
  }, [groups, releasedIds]);

  const views = useMemo(
    () =>
      groups.map((group) => {
        const questions = group.bank.filter(
          (question) =>
            matchesSearch(question, needle) &&
            matchesFilter(question, filter, releasedIds.has(question.id)),
        );
        const stagedAdds = group.bank.filter(
          (question) => staged.kindFor(question.id) === "add",
        ).length;
        const stagedRemovals = group.released.filter(
          (row) => staged.kindFor(row.id) === "remove",
        ).length;
        return {
          group,
          questions,
          nextCount: group.releasedCount + stagedAdds - stagedRemovals,
        };
      }),
    [groups, needle, filter, releasedIds, staged],
  );

  const anyVisible = views.some((view) => view.questions.length > 0);

  return (
    <section
      aria-labelledby="bank-heading"
      className="flex min-w-0 flex-col rounded-panel bg-sheet"
    >
      <Tabs
        className="gap-0"
        onValueChange={(value) => setFilter(value as BankFilter)}
        value={filter}
      >
        <div className="sticky top-(--header-h) z-10 flex flex-col gap-3 rounded-t-panel border-b border-rule bg-sheet px-4 pt-4 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="type-h3 text-ink" id="bank-heading">
              Question bank{" "}
              <span className="type-mono text-ink-muted">
                {filterCounts.all}
              </span>
            </h2>
            <div className="flex items-center gap-1">
              <Button onClick={onExpandAll} size="sm" type="button" variant="ghost">
                Expand all
              </Button>
              <Button
                onClick={onCollapseAll}
                size="sm"
                type="button"
                variant="ghost"
              >
                Collapse all
              </Button>
            </div>
          </div>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
            />
            <Input
              aria-label="Search the question bank"
              className="pl-9"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search prompt, tag, or id…"
              type="search"
              value={search}
            />
          </div>
          <TabsList
            aria-label="Filter the bank by state"
            className="max-w-full overflow-x-auto"
            variant="segmented"
          >
            {FILTERS.map((entry) => (
              <TabsTrigger
                count={filterCounts[entry.id]}
                key={entry.id}
                value={entry.id}
              >
                {entry.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent className="flex flex-col" value={filter}>
          {views.map(({ group, questions, nextCount }) => {
            if (questions.length === 0) {
              return null;
            }
            const isOpen =
              openTopics.has(group.topic.id) ||
              needle.length > 0 ||
              filter !== "all";
            const listId = `bank-${group.topic.id}`;
            const changed = nextCount !== group.releasedCount;

            return (
              <section
                aria-labelledby={`${listId}-heading`}
                className="border-b border-rule last:border-b-0"
                key={group.topic.id}
              >
                <h3
                  className="bg-surface-tint px-3 py-1.5"
                  id={`${listId}-heading`}
                >
                  <button
                    aria-controls={listId}
                    aria-expanded={isOpen}
                    className="flex min-h-10 w-full min-w-0 items-center gap-2 rounded-control text-left focus-ring"
                    onClick={() => onSetTopicOpen(group.topic.id, !isOpen)}
                    type="button"
                  >
                    <ChevronRight
                      aria-hidden="true"
                      className={cn(
                        "size-4 shrink-0 text-ink-muted transition-transform duration-fast ease-out",
                        isOpen && "rotate-90",
                      )}
                    />
                    <span className="type-body-strong min-w-0 flex-1 truncate text-ink">
                      {group.label}
                    </span>
                    <span className="type-caption shrink-0 tabular">
                      {group.releasedCount}
                      {changed ? (
                        <span className="text-ink"> → {nextCount}</span>
                      ) : null}{" "}
                      of {group.bankCount} released
                      <span className="sr-only"> to {sectionLabel}</span>
                    </span>
                  </button>
                </h3>

                {isOpen ? (
                  <div id={listId}>
                    <ul>
                      {questions.map((question) => (
                        <BankQuestionRow
                          courseId={courseId}
                          key={question.id}
                          onToggle={() => onStageToggle(question.id)}
                          question={question}
                          released={releasedIds.has(question.id)}
                          sectionLabel={sectionLabel}
                          staged={staged.kindFor(question.id) !== undefined}
                        />
                      ))}
                    </ul>
                    <div className="px-3 pt-1 pb-3">
                      <Button asChild size="sm" variant="ghost">
                        <Link href={courseTopicPath(courseId, group.topic.id)}>
                          <Plus aria-hidden="true" />
                          Add a question to this topic
                        </Link>
                      </Button>
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })}

          {!anyVisible ? (
            <p className="type-body px-4 py-6 text-ink-muted">
              No questions match that search or filter.
            </p>
          ) : null}
        </TabsContent>
      </Tabs>
    </section>
  );
}
