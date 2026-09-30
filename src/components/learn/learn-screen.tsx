"use client";

import { useMemo, useState } from "react";

import { AtAGlance } from "@/components/learn/at-a-glance";
import { ContinueCard } from "@/components/learn/continue-card";
import { GuestNotice } from "@/components/learn/guest-notice";
import type { LearnModel } from "@/components/learn/learn-model";
import { LearnToolbar } from "@/components/learn/learn-toolbar";
import { CourseChangeLink } from "@/components/course/course-change-link";
import { SavedPractice } from "@/components/learn/saved-practice";
import { SyllabusList } from "@/components/learn/syllabus-list";
import { WeekStrip } from "@/components/learn/week-strip";
import { ThreeColumn } from "@/components/shell/three-column";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

/** Recent practice rows shown before "Show all" below 1280px. */
const RECENT_LIMIT_NARROW = 3;

/**
 * The student's home: one Continue card, then the syllabus. There is no
 * syllabus rail here: the syllabus is the page, and a second copy beside it
 * would only disagree about the current topic.
 *
 * From 1280px "This week", "Recent practice" and "At a glance" sit in a
 * right column. Below that, "This week" is one line under the Continue card,
 * "Recent practice" (three rows and "Show all") comes before the syllabus,
 * and "At a glance" comes last. A guest who has solved nothing sees only the
 * Continue card, the syllabus and the guest note: empty trackers are noise.
 */
export function LearnScreen({
  course,
  model,
}: {
  course?: { id: string; title: string };
  model: LearnModel;
}) {
  const [search, setSearch] = useState("");

  const visibleTopics = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query.length === 0) {
      return model.topics;
    }
    return model.topics.filter((topic) =>
      topic.title.toLowerCase().includes(query),
    );
  }, [model.topics, search]);

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

  const recentCount = model.saved.active.length + model.saved.retired.length;
  const showTrackers = !(model.isGuest && model.glance.solved === 0);
  const filtering = search.trim().length > 0;

  return (
    <ThreeColumn drawerOpen={false}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 xl:max-w-6xl">
        <PageHeader
          title="Learn"
          eyebrow={course?.title}
          actions={course ? <CourseChangeLink returnTo="/learn" /> : undefined}
        >
          {model.isGuest ? <GuestNotice returnTo="/learn" /> : null}
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
              {model.topics.length === 0 ? (
                <EmptyState className="py-2">
                  {course
                    ? `${course.title} doesn't have any topics yet. Your professor is still setting it up.`
                    : "There are no topics yet."}
                </EmptyState>
              ) : (
                <ContinueCard
                  card={model.continueCard}
                  positionTotal={continueTotal}
                  question={continueQuestion}
                />
              )}
              {showTrackers ? (
                <p className="type-small tabular text-ink xl:hidden">
                  <span className="type-label">This week: </span>
                  {model.week.summary}
                </p>
              ) : null}
            </section>

            {recentCount > 0 ? (
              <section
                aria-labelledby="learn-recent-narrow"
                className="flex flex-col gap-2 xl:hidden"
              >
                <h2 id="learn-recent-narrow" className="type-label">
                  Recent practice
                </h2>
                <SavedPractice
                  active={model.saved.active}
                  limit={RECENT_LIMIT_NARROW}
                  retired={model.saved.retired}
                />
              </section>
            ) : null}

            <section
              aria-labelledby="learn-syllabus"
              data-tour="learn-syllabus"
              className="flex flex-col gap-3"
            >
              <h2 id="learn-syllabus" className="type-label">
                Syllabus
              </h2>
              {model.topics.length > 0 ? (
                <LearnToolbar
                  onSearchChange={setSearch}
                  search={search}
                  searchLabel="Search topics"
                  searchPlaceholder="Search topics…"
                />
              ) : null}
              <p role="status" className="sr-only">
                {filtering
                  ? `${visibleTopics.length} of ${model.topics.length} topics shown`
                  : ""}
              </p>
              {model.topics.length > 0 ? (
                <SyllabusList
                  emptyAction={
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setSearch("")}
                    >
                      Show all topics
                    </Button>
                  }
                  emptyMessage="No topic matches that search."
                  topics={visibleTopics}
                />
              ) : null}
            </section>
          </div>

          {showTrackers || recentCount > 0 ? (
            <div className="flex min-w-0 flex-col gap-10">
              {showTrackers ? (
                <section
                  aria-labelledby="learn-week"
                  className="hidden flex-col gap-3 xl:flex"
                >
                  <h2 id="learn-week" className="type-label">
                    This week
                  </h2>
                  <WeekStrip week={model.week} />
                </section>
              ) : null}

              <section
                aria-labelledby="learn-recent"
                className="hidden flex-col gap-2 xl:flex"
              >
                <h2 id="learn-recent" className="type-label">
                  Recent practice{" "}
                  {recentCount > 0 ? (
                    <span className="tabular">{recentCount}</span>
                  ) : null}
                </h2>
                <SavedPractice
                  active={model.saved.active}
                  retired={model.saved.retired}
                />
              </section>

              {showTrackers ? (
                <section
                  aria-labelledby="learn-glance"
                  className="flex flex-col gap-3"
                >
                  <h2 id="learn-glance" className="type-label">
                    At a glance
                  </h2>
                  <AtAGlance glance={model.glance} />
                </section>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </ThreeColumn>
  );
}
