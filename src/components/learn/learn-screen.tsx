"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { AtAGlance } from "@/components/learn/at-a-glance";
import { ContinueCard } from "@/components/learn/continue-card";
import type { LearnModel } from "@/components/learn/learn-model";
import {
  LearnToolbar,
  matchesLearnFilter,
  type LearnFilter,
} from "@/components/learn/learn-toolbar";
import { SavedPractice } from "@/components/learn/saved-practice";
import { SyllabusList } from "@/components/learn/syllabus-list";
import { WeekStrip } from "@/components/learn/week-strip";
import { SyllabusRail } from "@/components/shell/app-rail";
import { ThreeColumn } from "@/components/shell/three-column";

const ZONE_LABEL = "text-xs tracking-wide text-muted-foreground uppercase";

/**
 * H1 — the merge of the old dashboard and the old topic index. Four zones in
 * one column: what to continue, what this week looked like, the whole
 * syllabus, and the practice already saved. The rail and zone 3 are the same
 * data: the rail navigates, the list is read.
 */
export function LearnScreen({ model }: { model: LearnModel }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LearnFilter>("all");

  const activeTopicId = model.topics.find((topic) => topic.isCurrent)?.id;

  const visibleTopics = useMemo(() => {
    const query = search.trim().toLowerCase();

    return model.topics.filter((topic) => {
      if (query.length > 0 && !topic.title.toLowerCase().includes(query)) {
        return false;
      }
      if (filter === "all") {
        return true;
      }
      return model.questions.some(
        (question) =>
          question.topicId === topic.id && matchesLearnFilter(question, filter),
      );
    });
  }, [filter, model.questions, model.topics, search]);

  const unsolvedHrefs = useMemo(() => {
    const visible = new Set(visibleTopics.map((topic) => topic.id));
    return model.questions
      .filter(
        (question) =>
          visible.has(question.topicId) && question.status === "todo",
      )
      .map((question) => question.href);
  }, [model.questions, visibleTopics]);

  return (
    <ThreeColumn
      drawerOpen={false}
      rail={
        <SyllabusRail topics={model.topics} activeTopicId={activeTopicId} />
      }
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
        <h1 className="sr-only">Learn</h1>

        <section
          aria-labelledby="learn-continue"
          className="flex flex-col gap-3"
        >
          <h2 id="learn-continue" className={ZONE_LABEL}>
            Continue
          </h2>
          {model.isGuest ? <GuestNotice /> : null}
          <ContinueCard card={model.continueCard} />
        </section>

        <section aria-labelledby="learn-week" className="flex flex-col gap-3">
          <h2 id="learn-week" className={ZONE_LABEL}>
            This week
          </h2>
          <WeekStrip week={model.week} />
        </section>

        <section
          aria-labelledby="learn-syllabus"
          className="flex flex-col gap-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="learn-syllabus" className={ZONE_LABEL}>
              Syllabus
            </h2>
            <LearnToolbar
              filter={filter}
              onFilterChange={setFilter}
              onSearchChange={setSearch}
              search={search}
              searchLabel="Search topics"
              searchPlaceholder="Search topics"
              unsolvedHrefs={unsolvedHrefs}
            />
          </div>
          <SyllabusList
            emptyMessage="No topic matches that filter."
            topics={visibleTopics}
          />
        </section>

        <section aria-labelledby="learn-saved" className="flex flex-col gap-3">
          <h2 id="learn-saved" className={ZONE_LABEL}>
            {`Saved practice (${model.saved.active.length}) · Retired (${model.saved.retired.length})`}
          </h2>
          <SavedPractice
            active={model.saved.active}
            retired={model.saved.retired}
          />
        </section>

        <section
          aria-labelledby="learn-glance"
          className="hidden flex-col gap-3 xl:flex"
        >
          <h2 id="learn-glance" className={ZONE_LABEL}>
            At a glance
          </h2>
          <AtAGlance glance={model.glance} />
        </section>
      </div>
    </ThreeColumn>
  );
}

function GuestNotice() {
  return (
    <p className="rounded-[6px] border border-border px-4 py-2.5 text-sm text-muted-foreground">
      You&rsquo;re practising as a guest.{" "}
      <Link
        href="/join"
        className="text-primary underline-offset-4 hover:underline"
      >
        Join with a code or sign in
      </Link>{" "}
      to keep your progress.
    </p>
  );
}
