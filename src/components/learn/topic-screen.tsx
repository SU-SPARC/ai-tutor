"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type {
  LearnQuestionRow,
  LearnTopicRow,
  TopicModel,
} from "@/components/learn/learn-model";
import {
  MASTERY_LEVEL_TITLES,
  questionActionLabel,
  solvedCountLabel,
  topicMasteryLevel,
  weekLabel,
} from "@/components/learn/learn-model";
import { GuestNoticeText } from "@/components/learn/guest-notice";
import { LearnSyllabusRail } from "@/components/learn/learn-syllabus-rail";
import {
  LearnToolbar,
  matchesLearnFilter,
  type LearnFilter,
  type LearnSort,
} from "@/components/learn/learn-toolbar";
import { QuestionRow } from "@/components/learn/question-row";
import { TopicDotRow } from "@/components/learn/topic-dot-row";
import { BackBar } from "@/components/shell/back-bar";
import { BottomBar, BottomBarSpacer } from "@/components/shell/bottom-bar";
import { ThreeColumn } from "@/components/shell/three-column";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LocalDate } from "@/components/ui/local-date";
import { MasteryBar, MasteryChip } from "@/components/ui/mastery-chip";
import { PageHeader } from "@/components/ui/page-header";

const DIFFICULTY_RANK: Record<LearnQuestionRow["difficulty"], number> = {
  foundational: 0,
  intermediate: 1,
  challenge: 2,
};

/** Above this many questions a topic gets search, sort, filter and shuffle. */
const TOOLBAR_THRESHOLD = 8;

const STATUS_RANK: Record<LearnQuestionRow["status"], number> = {
  current: 0,
  todo: 1,
  done: 2,
  retired: 3,
};

/**
 * The next question in the topic: the one in progress, else the first not
 * started. `undefined` when everything is solved or retired.
 */
function nextQuestion(questions: LearnQuestionRow[]) {
  return (
    questions.find((question) => question.status === "current") ??
    questions.find((question) => question.status === "todo")
  );
}

export type NextTopicLink = {
  href: string;
  title: string;
  weekNumber: number;
};

/**
 * One topic. The header says where the student stands in words (mastery
 * level and "2 of 5 solved") and offers the one next step; the dot row says
 * the same at a glance; the list below answers "which one next?". The About
 * panel is rendered once: a right column from 1280px, after the list below.
 *
 * The one next step is never missing: "Start/Continue question n" while there
 * is work left, then "Next topic: Week 4 · {title} →" (or "Back to Learn"
 * when the whole syllabus is solved). On phones it also sits in a bottom bar,
 * in the thumb zone.
 */
export function TopicScreen({
  model,
  nextTopic,
  topics,
}: {
  model: TopicModel;
  /** The next unfinished topic, for a finished topic's forward step. */
  nextTopic?: NextTopicLink;
  topics: LearnTopicRow[];
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LearnFilter>("all");
  const [sort, setSort] = useState<LearnSort>("syllabus");

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = model.questions.filter((question) => {
      if (query.length > 0 && !question.title.toLowerCase().includes(query)) {
        return false;
      }
      return matchesLearnFilter(question, filter);
    });

    return [...rows].sort((left, right) => {
      if (sort === "difficulty") {
        return (
          DIFFICULTY_RANK[left.difficulty] -
            DIFFICULTY_RANK[right.difficulty] || left.position - right.position
        );
      }
      if (sort === "status") {
        return (
          STATUS_RANK[left.status] - STATUS_RANK[right.status] ||
          left.position - right.position
        );
      }
      return left.position - right.position;
    });
  }, [filter, model.questions, search, sort]);

  const unsolvedHrefs = useMemo(
    () =>
      visible
        .filter((question) => question.status === "todo")
        .map((question) => question.href),
    [visible],
  );

  const total = model.questions.length;
  const showToolbar = total > TOOLBAR_THRESHOLD;
  const hasRemoved = model.questions.some(
    (question) => question.status === "retired",
  );
  const filtering = search.trim().length > 0 || filter !== "all";
  const solved = model.questions.filter(
    (question) => question.status === "done",
  ).length;
  const touched = model.questions.some(
    (question) => question.status === "done" || question.status === "current",
  );
  const level = topicMasteryLevel({
    glyph: touched ? "current" : "todo",
    solved,
    total,
  });
  const next = nextQuestion(model.questions);
  const complete = total > 0 && !next;

  // The one mint action: the next question, else the next topic, else home.
  const primary = next
    ? { href: next.href, label: questionActionLabel(next) }
    : complete
      ? nextTopic
        ? {
            href: nextTopic.href,
            label: `Next topic: ${weekLabel(nextTopic.weekNumber)} · ${nextTopic.title} →`,
          }
        : { href: "/learn", label: "Back to Learn" }
      : undefined;

  const primaryButton = (className: string) =>
    primary ? (
      <Button asChild variant="cta" size="lg" className={className}>
        <Link href={primary.href}>{primary.label}</Link>
      </Button>
    ) : null;

  return (
    <ThreeColumn
      mobileTop={<BackBar href="/learn" label="Learn" />}
      rail={<LearnSyllabusRail activeTopicId={model.id} topics={topics} />}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 xl:max-w-6xl">
        <PageHeader
          actions={
            primary ? (
              <>
                {/* Below 640px the same action lives in the bottom bar. */}
                {primaryButton("hidden sm:inline-flex")}
                {complete ? (
                  <Button asChild variant="outline" size="lg">
                    <Link href={model.about.extraPracticeHref}>
                      Extra practice
                    </Link>
                  </Button>
                ) : null}
              </>
            ) : undefined
          }
          description={model.description}
          eyebrow={<span className="type-mono">{model.weekLabel}</span>}
          notice={
            model.isGuest ? (
              <GuestNoticeText returnTo={`/learn/${model.id}`} />
            ) : undefined
          }
          title={model.title}
        >
          {level !== undefined ? (
            <div className="mt-2 flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <MasteryChip
                  level={level}
                  title={MASTERY_LEVEL_TITLES[level]}
                />
                <span className="type-small tabular text-ink">
                  {solvedCountLabel(solved, total)}
                </span>
                <span aria-hidden="true" className="flex w-32">
                  <MasteryBar value={solved} total={total} />
                </span>
              </div>
              {complete ? (
                <p className="type-small tabular text-ink">
                  {`Topic complete: ${solvedCountLabel(solved, total)}`}
                </p>
              ) : null}
            </div>
          ) : null}
          {model.closedAt ? (
            <p className="type-small mt-2 text-ink-muted">
              This week closed on <LocalDate iso={model.closedAt} />. You can
              still practice its questions.
            </p>
          ) : null}
        </PageHeader>

        <div className="grid grid-cols-1 gap-10 xl:grid-cols-[minmax(0,1fr)_18rem] xl:gap-12">
          <section
            aria-labelledby="topic-questions"
            className="flex min-w-0 flex-col gap-4"
          >
            <h2 id="topic-questions" className="type-label">
              Questions
            </h2>

            {total > 0 ? (
              <>
                {showToolbar ? (
                  <LearnToolbar
                    filter={filter}
                    filterLabel="Filter questions"
                    onFilterChange={setFilter}
                    onSearchChange={setSearch}
                    onSortChange={setSort}
                    search={search}
                    searchLabel="Search questions"
                    searchPlaceholder="Search questions…"
                    showRemovedFilter={hasRemoved}
                    sort={sort}
                    unsolvedHrefs={unsolvedHrefs}
                  />
                ) : null}
                <TopicDotRow questions={model.questions} />
                <p role="status" className="sr-only">
                  {filtering
                    ? `${visible.length} of ${total} questions shown`
                    : ""}
                </p>
              </>
            ) : null}

            {total === 0 ? (
              <EmptyState
                action={
                  <Button asChild variant="secondary">
                    <Link href="/learn">Back to Learn</Link>
                  </Button>
                }
              >
                Nothing to practice here yet. Your professor adds questions to
                this topic as they are reviewed.
              </EmptyState>
            ) : visible.length === 0 ? (
              <EmptyState
                action={
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setSearch("");
                      setFilter("all");
                    }}
                  >
                    Show all questions
                  </Button>
                }
              >
                No question matches that search or filter.
              </EmptyState>
            ) : (
              <ul className="flex flex-col gap-3">
                {visible.map((question) => (
                  <li key={question.id}>
                    <QuestionRow
                      question={question}
                      topicTotal={total}
                      upNext={question.id === next?.id}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <AboutPanel model={model} />
        </div>

        {primary ? (
          <>
            <BottomBarSpacer className="sm:hidden" />
            <BottomBar
              hideFrom={false}
              className="sm:hidden"
              label="Next step"
              end={primaryButton("w-full")}
            />
          </>
        ) : null}
      </div>
    </ThreeColumn>
  );
}

/**
 * The facts about the topic and the one action that must never compete with
 * the assigned list: extra practice. Rendered once — beside the list from
 * 1280px, after it below that.
 */
function AboutPanel({ model }: { model: TopicModel }) {
  const hasQuestions = model.questions.length > 0;

  return (
    <aside
      aria-labelledby="topic-about"
      className="flex flex-col gap-4 self-start rounded-panel bg-surface-tint p-5"
    >
      <h2 id="topic-about" className="type-label">
        About this topic
      </h2>
      <ul className="flex flex-col gap-1">
        <li className="type-small tabular text-ink">
          {model.about.questionCountLabel}
        </li>
        {model.about.doneLabel ? (
          <li className="type-small tabular text-ink-muted">
            {model.about.doneLabel}
          </li>
        ) : null}
      </ul>
      {hasQuestions ? (
        <div className="flex flex-col gap-2">
          <h3 className="type-body-strong text-ink">Extra practice</h3>
          <p className="type-small text-ink-muted">
            More questions like these. They don&rsquo;t change your syllabus
            progress.
          </p>
          <Button asChild variant="outline" className="w-full">
            <Link href={model.about.extraPracticeHref}>Try extra practice</Link>
          </Button>
        </div>
      ) : null}
    </aside>
  );
}
