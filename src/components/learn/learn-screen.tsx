"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { AtAGlance } from "@/components/learn/at-a-glance";
import { ContinueCard } from "@/components/learn/continue-card";
import type { LearnModel } from "@/components/learn/learn-model";
import { LearnSyllabusRail } from "@/components/learn/learn-syllabus-rail";
import {
  LearnToolbar,
  matchesLearnFilter,
  type LearnFilter,
} from "@/components/learn/learn-toolbar";
import { SavedPractice } from "@/components/learn/saved-practice";
import { SyllabusList } from "@/components/learn/syllabus-list";
import { WeekStrip } from "@/components/learn/week-strip";
import { ThreeColumn } from "@/components/shell/three-column";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

/**
 * The student's home: the old dashboard and the old topic index in one page,
 * because both existed to answer "what next?". One Continue card, then the
 * syllabus; the record of the week, saved practice and the month sit in a
 * right column from 1280px and follow the syllabus below that.
 */
export function LearnScreen({ model }: { model: LearnModel }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LearnFilter>("all");

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

  // The question the Continue card points at, for its prompt and position.
  const continueHref = model.continueCard.primary?.href;
  const continueQuestion = continueHref
    ? model.questions.find((question) => question.href === continueHref)
    : undefined;
  const continueTotal = continueQuestion
    ? model.questions.filter(
        (question) => question.topicId === continueQuestion.topicId,
      ).length
    : undefined;

  const savedCount = model.saved.active.length;
  const filtering = search.trim().length > 0 || filter !== "all";

  return (
    <ThreeColumn
      drawerOpen={false}
      rail={<LearnSyllabusRail topics={model.topics} />}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 xl:max-w-6xl">
        <PageHeader title="Learn">
          {model.isGuest ? <GuestNotice /> : null}
        </PageHeader>

        <div className="grid grid-cols-1 gap-12 xl:grid-cols-[minmax(0,1fr)_18rem] xl:gap-12">
          <div className="flex min-w-0 flex-col gap-12">
            <section
              aria-labelledby="learn-continue"
              className="flex flex-col gap-3"
            >
              <h2 id="learn-continue" className="type-label">
                Continue
              </h2>
              <ContinueCard
                card={model.continueCard}
                positionTotal={continueTotal}
                question={continueQuestion}
              />
            </section>

            <section
              aria-labelledby="learn-syllabus"
              className="flex flex-col gap-3"
            >
              <h2 id="learn-syllabus" className="type-label">
                Syllabus
              </h2>
              <LearnToolbar
                filter={filter}
                filterLabel="Filter topics"
                onFilterChange={setFilter}
                onSearchChange={setSearch}
                search={search}
                searchLabel="Search topics"
                searchPlaceholder="Search topics…"
                unsolvedHrefs={unsolvedHrefs}
              />
              <p role="status" className="sr-only">
                {filtering
                  ? `${visibleTopics.length} of ${model.topics.length} topics shown`
                  : ""}
              </p>
              <SyllabusList
                emptyAction={
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setSearch("");
                      setFilter("all");
                    }}
                  >
                    Show all topics
                  </Button>
                }
                emptyMessage="No topic matches that search or filter."
                topics={visibleTopics}
              />
            </section>
          </div>

          <div className="flex min-w-0 flex-col gap-10">
            <section
              aria-labelledby="learn-week"
              className="flex flex-col gap-3"
            >
              <h2 id="learn-week" className="type-label">
                This week
              </h2>
              <WeekStrip week={model.week} />
            </section>

            <section
              aria-labelledby="learn-saved"
              className="flex flex-col gap-2"
            >
              <h2 id="learn-saved" className="type-label">
                Saved practice{" "}
                {savedCount > 0 ? (
                  <span className="tabular">{savedCount}</span>
                ) : null}
              </h2>
              <SavedPractice
                active={model.saved.active}
                retired={model.saved.retired}
              />
            </section>

            <section
              aria-labelledby="learn-glance"
              className="flex flex-col gap-3"
            >
              <h2 id="learn-glance" className="type-label">
                At a glance
              </h2>
              <AtAGlance glance={model.glance} />
            </section>
          </div>
        </div>
      </div>
    </ThreeColumn>
  );
}

function GuestNotice() {
  return (
    <Alert role="note" variant="info" className="mt-2 max-w-prose">
      <p className="type-body col-start-2 text-ink">
        You&rsquo;re practicing as a guest.{" "}
        <Link
          href="/join"
          className="rounded-xs text-azure-500 underline underline-offset-4 hover:text-azure-700 focus-ring"
        >
          Join with a code or sign in
        </Link>{" "}
        to keep your progress.
      </p>
    </Alert>
  );
}
