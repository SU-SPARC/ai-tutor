"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";

import { BankQuestionRow } from "@/components/courses/bank-question-row";
import type { BuilderGroup } from "@/components/courses/builder-released-pane";
import type { StagedChanges } from "@/components/courses/use-staged-changes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { courseTopicPath } from "@/lib/courses/paths";
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
  { id: "approved_not_released", label: "Approved, not released" },
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
      // honest reading of the chip: it can't be out there, and here is why.
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
    <Card className="flex flex-col">
      <CardHeader className="sticky top-0 z-10 gap-3 rounded-t-lg border-b border-border bg-card">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Question bank
        </h2>
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search prompt / tag / id"
          aria-label="Search the question bank"
          className="h-9"
        />
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((entry) => (
            <Button
              key={entry.id}
              type="button"
              size="sm"
              variant={filter === entry.id ? "secondary" : "outline"}
              aria-pressed={filter === entry.id}
              onClick={() => setFilter(entry.id)}
            >
              {entry.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onExpandAll}>
            Expand all
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onCollapseAll}
          >
            Collapse all
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 p-0">
        {views.map(({ group, questions, nextCount }) => {
          if (questions.length === 0) {
            return null;
          }
          const isOpen =
            openTopics.has(group.topic.id) ||
            needle.length > 0 ||
            filter !== "all";
          const Chevron = isOpen ? ChevronDown : ChevronRight;

          return (
            <details
              key={group.topic.id}
              open={isOpen}
              onToggle={(event) => {
                const nextOpen = event.currentTarget.open;
                if (nextOpen !== isOpen) {
                  onSetTopicOpen(group.topic.id, nextOpen);
                }
              }}
              className="border-b border-border last:border-b-0"
            >
              <summary
                className="flex cursor-pointer list-none items-center gap-2 bg-muted/30 px-3 py-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset [&::-webkit-details-marker]:hidden"
                onClick={(event) => {
                  event.preventDefault();
                  onSetTopicOpen(group.topic.id, !isOpen);
                }}
              >
                <Chevron
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {group.label}{" "}
                  <span className="font-normal text-muted-foreground">
                    ({group.bankCount})
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {group.releasedCount}
                  {nextCount === group.releasedCount ? null : (
                    <span className="text-foreground">→{nextCount}</span>
                  )}
                  /{group.bankCount}
                  <span className="sr-only">
                    {" "}
                    released to {sectionLabel} of {group.bankCount} in the bank
                  </span>
                </span>
              </summary>

              <ul>
                {questions.map((question) => (
                  <BankQuestionRow
                    key={question.id}
                    courseId={courseId}
                    onToggle={() => onStageToggle(question.id)}
                    question={question}
                    released={releasedIds.has(question.id)}
                    sectionLabel={sectionLabel}
                    staged={staged.kindFor(question.id) !== undefined}
                  />
                ))}
              </ul>

              {/* Whop's dashed add-row: it stays where the professor's eye is. */}
              <div className="px-3 pt-1 pb-3">
                <Link
                  href={courseTopicPath(courseId, group.topic.id)}
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add question to this topic
                </Link>
              </div>
            </details>
          );
        })}

        {!anyVisible ? (
          <p className="p-6 text-sm text-muted-foreground">
            No questions match that search or filter.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
