"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Undo2 } from "lucide-react";

import { BuilderTopicHeader } from "@/components/courses/builder-topic-header";
import { CopyToSectionMenu } from "@/components/courses/copy-to-section-menu";
import { ReleasedQuestionRow } from "@/components/courses/released-question-row";
import type { StagedChanges } from "@/components/courses/use-staged-changes";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { sectionBuilder } from "@/lib/courses/selectors";
import type {
  ReleasedQuestion,
  SectionBuilderTopic,
} from "@/lib/courses/selectors";
import type {
  BankQuestion,
  CourseSection,
  CoursesState,
  QuestionId,
  SectionId,
  TopicId,
} from "@/lib/courses/types";

/**
 * A topic group on the builder, with the held rows `sectionBuilder` leaves out.
 */
export type BuilderGroup = SectionBuilderTopic & {
  /** Rows the section still owns but cannot show — the version was unpublished. */
  held: ReleasedQuestion[];
};

/**
 * `sectionBuilder` only returns rows in the `released` state, because that is
 * what students can see. S3 also has to show the held rows, so this local
 * helper folds them back in; it is the one piece of read-model the shared
 * selectors do not already provide.
 */
export function buildBuilderGroups(
  state: CoursesState,
  sectionId: SectionId,
): BuilderGroup[] {
  const heldRows = new Map(
    state.questionAvailability
      .filter((row) => row.sectionId === sectionId && row.state === "held")
      .map((row) => [row.questionId, row]),
  );

  return sectionBuilder(state, sectionId).map((group) => {
    const held: ReleasedQuestion[] = [];
    for (const question of group.bank) {
      const row = heldRows.get(question.id);
      if (!row) {
        continue;
      }
      const { state: lifecycleState, ...rest } = question;
      held.push({ ...rest, ...row, lifecycleState });
    }
    held.sort(
      (left, right) =>
        left.position - right.position || left.id.localeCompare(right.id),
    );
    return { ...group, held };
  });
}

function matchesReleasedSearch(row: ReleasedQuestion, needle: string) {
  if (needle.length === 0) {
    return true;
  }
  return (
    row.title.toLowerCase().includes(needle) ||
    row.id.toLowerCase().includes(needle)
  );
}

export function BuilderReleasedPane({
  flash,
  groups,
  onCopyTo,
  onDiscard,
  onReview,
  onSetTopicOpen,
  onStageToggle,
  openTopics,
  otherSections,
  sectionId,
  sectionLabel,
  staged,
}: {
  /** Transient "Released 4 · removed 2 to Sec 01" line, or null. */
  flash: string | null;
  groups: BuilderGroup[];
  onCopyTo: (targetSectionId: SectionId) => void;
  onDiscard: () => void;
  onReview: () => void;
  onSetTopicOpen: (topicId: TopicId, open: boolean) => void;
  onStageToggle: (questionId: QuestionId) => void;
  openTopics: ReadonlySet<TopicId>;
  otherSections: CourseSection[];
  sectionId: SectionId;
  sectionLabel: string;
  staged: StagedChanges;
}) {
  const [search, setSearch] = useState("");
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<QuestionId>>(
    () => new Set(),
  );
  const needle = search.trim().toLowerCase();

  const toggleExpanded = (questionId: QuestionId) =>
    setExpandedRows((previous) => {
      const next = new Set(previous);
      if (next.has(questionId)) {
        next.delete(questionId);
      } else {
        next.add(questionId);
      }
      return next;
    });

  /** Counts read live: what the section would hold if the professor applied now. */
  const views = useMemo(
    () =>
      groups.map((group) => {
        // Position is what `section/moveReleased` reorders, so the held rows
        // are merged back into that order rather than appended.
        const rows = [...group.released, ...group.held].sort(
          (left, right) =>
            left.position - right.position || left.id.localeCompare(right.id),
        );
        const stagedAdds = group.bank.filter(
          (question) => staged.kindFor(question.id) === "add",
        );
        const stagedRemovals = group.released.filter(
          (row) => staged.kindFor(row.id) === "remove",
        ).length;
        return {
          group,
          rows,
          stagedAdds,
          liveCount: group.releasedCount + stagedAdds.length - stagedRemovals,
        };
      }),
    [groups, staged],
  );

  const liveTotal = views.reduce((total, view) => total + view.liveCount, 0);

  return (
    <Card className="flex flex-col">
      <CardHeader className="sticky top-0 z-10 gap-3 rounded-t-lg border-b border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Released to {sectionLabel} ({liveTotal})
          </h2>
          <CopyToSectionMenu
            disabled={staged.count > 0}
            sections={otherSections}
            onSelect={onCopyTo}
          />
        </div>
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search released…"
          aria-label={`Search questions released to ${sectionLabel}`}
          className="h-9"
        />
        {flash ? (
          <Alert variant="success">
            <CheckCircle2 aria-hidden="true" />
            <AlertDescription>{flash}</AlertDescription>
          </Alert>
        ) : null}
      </CardHeader>

      <CardContent className="flex-1 p-0">
        {views.map(({ group, rows, stagedAdds, liveCount }) => {
          const visibleRows = rows.filter((row) =>
            matchesReleasedSearch(row, needle),
          );
          const visibleAdds = stagedAdds.filter(
            (question) =>
              needle.length === 0 ||
              question.title.toLowerCase().includes(needle) ||
              question.id.toLowerCase().includes(needle),
          );
          if (
            needle.length > 0 &&
            visibleRows.length === 0 &&
            visibleAdds.length === 0
          ) {
            return null;
          }
          const isOpen =
            openTopics.has(group.topic.id) ||
            (needle.length > 0 &&
              (visibleRows.length > 0 || visibleAdds.length > 0));

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
                className="flex cursor-pointer list-none items-center bg-muted/30 px-3 py-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset [&::-webkit-details-marker]:hidden"
                onClick={(event) => {
                  // We own `open`, so the native toggle is always suppressed;
                  // clicks that land on the state control must not toggle at all.
                  event.preventDefault();
                  const target =
                    event.target instanceof Element ? event.target : null;
                  if (target?.closest("[data-summary-interactive]")) {
                    return;
                  }
                  onSetTopicOpen(group.topic.id, !isOpen);
                }}
              >
                <BuilderTopicHeader
                  availability={group.availability}
                  count={liveCount}
                  label={group.label}
                  open={isOpen}
                  sectionId={sectionId}
                  topicId={group.topic.id}
                />
              </summary>

              <ul>
                {visibleRows.length === 0 && visibleAdds.length === 0 ? (
                  <li className="px-3 py-3 text-sm text-muted-foreground">
                    Nothing released to {sectionLabel} in this topic yet. Add
                    published questions from the bank on the right.
                  </li>
                ) : null}

                {visibleRows.map((row) => (
                  <ReleasedQuestionRow
                    key={row.id}
                    expanded={expandedRows.has(row.id)}
                    // Move bounds come from the whole topic, not the filtered
                    // view, so searching never makes ▲/▼ lie about the ends.
                    index={rows.indexOf(row)}
                    onToggleExpanded={() => toggleExpanded(row.id)}
                    onToggleRemove={() => onStageToggle(row.id)}
                    row={row}
                    sectionId={sectionId}
                    sectionLabel={sectionLabel}
                    stagedRemove={staged.kindFor(row.id) === "remove"}
                    total={rows.length}
                  />
                ))}

                {visibleAdds.map((question) => (
                  <GhostAddRow
                    key={question.id}
                    onUndo={() => onStageToggle(question.id)}
                    question={question}
                    sectionLabel={sectionLabel}
                  />
                ))}
              </ul>
            </details>
          );
        })}

        {groups.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            This course has no included topics yet. Add them on the course
            overview.
          </p>
        ) : null}
      </CardContent>

      {staged.count > 0 ? (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-b-lg border-t border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {staged.count} staged
            </span>{" "}
            · adding {staged.addCount} · removing {staged.removeCount}
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onDiscard}>
              Discard
            </Button>
            <Button type="button" size="sm" onClick={onReview}>
              Review {staged.count} {staged.count === 1 ? "change" : "changes"}{" "}
              →
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

/** A staged add, shown where it will land once applied. */
function GhostAddRow({
  onUndo,
  question,
  sectionLabel,
}: {
  onUndo: () => void;
  question: BankQuestion;
  sectionLabel: string;
}) {
  return (
    <li className="px-3 py-2">
      <div className="flex items-start gap-2 rounded-md border border-dashed border-border bg-muted/20 px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm text-muted-foreground">
              {question.title}
            </span>
            <Badge variant="outline">adding</Badge>
            <span className="text-xs text-muted-foreground">
              v{question.publishedVersion ?? question.latestVersion}
            </span>
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground"
          aria-label={`Undo staged release of ${question.title} to ${sectionLabel}`}
          onClick={onUndo}
        >
          <Undo2 className="h-4 w-4" />
        </Button>
      </div>
    </li>
  );
}
