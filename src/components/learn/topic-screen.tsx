"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type {
  LearnQuestionRow,
  LearnTopicRow,
  TopicModel,
} from "@/components/learn/learn-model";
import {
  LearnToolbar,
  matchesLearnFilter,
  type LearnFilter,
  type LearnSort,
} from "@/components/learn/learn-toolbar";
import { QuestionRow } from "@/components/learn/question-row";
import { TopicDotRow } from "@/components/learn/topic-dot-row";
import { Button } from "@/components/ui/button";
import { SyllabusRail } from "@/components/shell/app-rail";
import { ThreeColumn } from "@/components/shell/three-column";

const DIFFICULTY_RANK: Record<LearnQuestionRow["difficulty"], number> = {
  foundational: 0,
  intermediate: 1,
  challenge: 2,
};

const STATUS_RANK: Record<LearnQuestionRow["status"], number> = {
  current: 0,
  todo: 1,
  done: 2,
  retired: 3,
};

/**
 * H2 — one topic. The dot row answers "where am I in this topic?" in a
 * glance; the list below answers "which one next?" Both lead to the same
 * place, `/practice/[id]`.
 */
export function TopicScreen({
  model,
  topics,
}: {
  model: TopicModel;
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

  return (
    <ThreeColumn
      drawer={<AboutPanel model={model} />}
      rail={<SyllabusRail topics={topics} activeTopicId={model.id} />}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-3">
          <p className="font-mono text-xs text-muted-foreground">
            <Link
              href="/learn"
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              Learn
            </Link>
            {` / ${model.weekLabel}`}
          </p>
          <h1 className="font-display text-[28px] leading-9 font-normal">
            {model.title}
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            {model.description}
          </p>
        </header>

        <section
          aria-labelledby="topic-questions"
          className="flex flex-col gap-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2
              id="topic-questions"
              className="text-xs tracking-wide text-muted-foreground uppercase"
            >
              Questions
            </h2>
            {model.questions.length > 0 ? (
              <LearnToolbar
                filter={filter}
                onFilterChange={setFilter}
                onSearchChange={setSearch}
                onSortChange={setSort}
                search={search}
                searchLabel="Search questions"
                searchPlaceholder="Search questions"
                sort={sort}
                unsolvedHrefs={unsolvedHrefs}
              />
            ) : null}
          </div>

          <TopicDotRow questions={model.questions} />

          {model.questions.length === 0 ? (
            <div className="rounded-lg bg-sheet p-6 text-sheet-foreground">
              <p className="text-sm text-muted-foreground">
                Nothing to practice here yet. Your professor adds questions to
                this topic as they are reviewed.
              </p>
            </div>
          ) : visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No question matches that filter.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {visible.map((question) => (
                <li key={question.id}>
                  <QuestionRow question={question} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* The drawer leaves below xl, so About — and with it the only way to
            ask for extra practice — comes back inline. */}
        <div className="xl:hidden">
          <AboutPanel model={model} />
        </div>
      </div>
    </ThreeColumn>
  );
}

/**
 * The About panel carries the facts about the topic and the one action that
 * must never compete with the assigned list: extra practice.
 */
function AboutPanel({ model }: { model: TopicModel }) {
  return (
    <div className="flex flex-col gap-4 rounded-lg bg-sheet p-5 text-sheet-foreground">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">
        About
      </p>
      <div className="flex flex-col gap-1">
        <p className="font-mono text-sm">{model.about.weekLabel}</p>
        <p className="text-sm text-muted-foreground">
          {model.about.questionCountLabel}
        </p>
        {model.isGuest ? null : (
          <p className="font-mono text-xs text-muted-foreground">
            {model.about.doneLabel}
          </p>
        )}
      </div>
      <Button asChild variant="outline" className="rounded-[6px]">
        <Link href={model.about.extraPracticeHref}>Extra practice</Link>
      </Button>
    </div>
  );
}
