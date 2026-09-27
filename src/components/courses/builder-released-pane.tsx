"use client";

import { useMemo, useState } from "react";
import { Search, Undo2 } from "lucide-react";

import { BuilderTopicHeader } from "@/components/courses/builder-topic-header";
import { StagedChip } from "@/components/courses/course-status";
import { CopyToSectionMenu } from "@/components/courses/copy-to-section-menu";
import { ReleasedQuestionRow } from "@/components/courses/released-question-row";
import type { StagedChanges } from "@/components/courses/use-staged-changes";
import { Button } from "@/components/ui/button";
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

/**
 * The left pane: what the section sees now, per topic, with staged adds shown
 * where they will land and staged removals struck through. Counts are live
 * (what the section would hold if the professor applied now).
 */
export function BuilderReleasedPane({
  groups,
  onCopyTo,
  onSetTopicOpen,
  onStageToggle,
  openTopics,
  otherSections,
  sectionId,
  sectionLabel,
  staged,
}: {
  groups: BuilderGroup[];
  onCopyTo: (targetSectionId: SectionId) => void;
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
  const headingId = `released-${sectionId}`;

  const shown = views
    .map((view) => {
      const visibleRows = view.rows.filter((row) =>
        matchesReleasedSearch(row, needle),
      );
      const visibleAdds = view.stagedAdds.filter(
        (question) =>
          needle.length === 0 ||
          question.title.toLowerCase().includes(needle) ||
          question.id.toLowerCase().includes(needle),
      );
      return { ...view, visibleRows, visibleAdds };
    })
    .filter(
      (view) =>
        needle.length === 0 ||
        view.visibleRows.length > 0 ||
        view.visibleAdds.length > 0,
    );

  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col rounded-panel bg-sheet"
    >
      <div className="sticky top-(--header-h) z-10 flex flex-col gap-3 rounded-t-panel border-b border-rule bg-sheet px-4 pt-4 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="type-h3 text-ink" id={headingId}>
            Released to {sectionLabel}{" "}
            <span className="type-mono text-ink-muted">{liveTotal}</span>
          </h2>
          <CopyToSectionMenu
            disabled={staged.count > 0}
            onSelect={onCopyTo}
            sections={otherSections}
          />
        </div>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
          />
          <Input
            aria-label={`Search questions released to ${sectionLabel}`}
            className="pl-9"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search released questions…"
            type="search"
            value={search}
          />
        </div>
      </div>

      <div className="flex flex-col">
        {shown.map(({ group, rows, visibleRows, visibleAdds, liveCount }) => {
          const isOpen =
            openTopics.has(group.topic.id) ||
            (needle.length > 0 &&
              (visibleRows.length > 0 || visibleAdds.length > 0));
          const listId = `released-${sectionId}-${group.topic.id}`;

          return (
            <section
              aria-labelledby={`${listId}-heading`}
              className="border-b border-rule last:border-b-0"
              key={group.topic.id}
            >
              <BuilderTopicHeader
                availability={group.availability}
                count={liveCount}
                headingId={`${listId}-heading`}
                label={group.label}
                listId={listId}
                onToggle={() => onSetTopicOpen(group.topic.id, !isOpen)}
                open={isOpen}
                sectionId={sectionId}
                sectionLabel={sectionLabel}
                topicId={group.topic.id}
              />
              {isOpen ? (
                <ul id={listId}>
                  {visibleRows.length === 0 && visibleAdds.length === 0 ? (
                    <li className="type-small px-4 py-3 text-ink-muted">
                      Nothing released to {sectionLabel} in this topic yet. Add
                      published questions from the bank.
                    </li>
                  ) : null}

                  {visibleRows.map((row) => (
                    <ReleasedQuestionRow
                      expanded={expandedRows.has(row.id)}
                      // Move bounds come from the whole topic, not the filtered
                      // view, so searching never makes ▲/▼ lie about the ends.
                      index={rows.indexOf(row)}
                      key={row.id}
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
                    <StagedAddRow
                      key={question.id}
                      onUndo={() => onStageToggle(question.id)}
                      question={question}
                      sectionLabel={sectionLabel}
                    />
                  ))}
                </ul>
              ) : null}
            </section>
          );
        })}

        {groups.length === 0 ? (
          <p className="type-body px-4 py-6 text-ink-muted">
            This course has no included topics yet. Include them from the
            course overview.
          </p>
        ) : null}
        {groups.length > 0 && shown.length === 0 ? (
          <p className="type-body px-4 py-6 text-ink-muted">
            Nothing released to {sectionLabel} matches “{search.trim()}”.
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** A staged add, shown where it will land once applied. */
function StagedAddRow({
  onUndo,
  question,
  sectionLabel,
}: {
  onUndo: () => void;
  question: BankQuestion;
  sectionLabel: string;
}) {
  return (
    <li className="flex items-start gap-2 border-b border-rule bg-azure-100 px-3 py-2 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1 sm:pl-16">
        <p className="type-small text-ink">{question.title}</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="type-caption tabular">
            v{question.publishedVersion ?? question.latestVersion}
          </span>
          <StagedChip kind="add" />
        </div>
      </div>
      <Button
        aria-label={`Undo staged release of ${question.title} to ${sectionLabel}`}
        className="shrink-0"
        onClick={onUndo}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <Undo2 aria-hidden="true" />
      </Button>
    </li>
  );
}
