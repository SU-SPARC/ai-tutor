import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { ProfessorHowItWorks } from "@/components/professor/professor-how-it-works";
import {
  formatProfessorDate,
  formatProfessorDateTime,
} from "@/components/professor/professor-question-labels";
import { PROFESSOR_SECTIONS } from "@/components/shell/nav-config";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type {
  ProfessorWorkspaceDecision,
  ProfessorWorkspaceOverview,
} from "@/lib/professor/workspace-overview";
import { professorQuestionPath } from "@/lib/professor/question-paths";
import type { QuestionLifecycleEventAction } from "@/lib/types";

/**
 * Past-tense phrasing for the decision history, in the professor's words.
 * `null` hides the event (system bookkeeping such as history migration).
 */
const DECISION_LABELS: Record<QuestionLifecycleEventAction, string | null> = {
  approve: "Approved",
  archive: "Removed from question bank:",
  create_version: "Edited",
  migrate: null,
  publish: "Showed to students",
  regenerate: "Asked AI to rewrite",
  reject: "Rejected",
  request_revision: "Sent back for changes:",
  restore: "Put back in question bank:",
  rollback: "Restored an earlier copy of",
  submit: "Sent for review:",
  unpublish: "Hid from students",
};

const RELEASE_DECISION_LABELS = {
  archived: "Hid from students",
  published: "Showed to students",
  unpublished: "Hid from students",
} as const;

const TOPIC_PREVIEW_LIMIT = 3;

const REVIEW_HREF = "/professor/review";
const ADD_QUESTION_HREF = "/professor/questions?tab=intake";
// The question bank already filters by `?view=` (its "approved" filter).
const APPROVED_HREF = "/professor/questions?view=approved";
const STUDENTS_SEE_HREF = "/professor/availability";

function decisionLabel(decision: ProfessorWorkspaceDecision) {
  return decision.kind === "lifecycle"
    ? DECISION_LABELS[decision.action]
    : RELEASE_DECISION_LABELS[decision.releaseState];
}

function plural(count: number, one: string, many: string) {
  return count === 1 ? one : many;
}

/**
 * A usable date or nothing: a missing value, an unparseable one, or the
 * epoch placeholder (Dec 31 1969 / Jan 1 1970) is never shown.
 */
function realDate(value: string | undefined) {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  if (Number.isNaN(time) || new Date(time).getUTCFullYear() <= 1970) {
    return undefined;
  }
  return value;
}

/**
 * Home's one next step: review what is waiting, or (when nothing waits) add
 * a question. The header button and the "Next step" card both use it, so
 * they always say the same thing.
 */
export function professorHomeNextStep(overview?: ProfessorWorkspaceOverview) {
  if (!overview) {
    return {
      href: REVIEW_HREF,
      label: "Review questions",
      sentence:
        "We couldn't count your questions just now. You can still open Review questions.",
    };
  }
  const waiting = overview.totalNeedsReview;
  if (waiting > 0) {
    return {
      href: REVIEW_HREF,
      label: `Review ${waiting} ${plural(waiting, "question", "questions")}`,
      sentence: `${waiting} ${plural(waiting, "question is", "questions are")} waiting for your review.`,
    };
  }
  return {
    href: ADD_QUESTION_HREF,
    label: "Add a question",
    sentence:
      "Nothing is waiting for your review. You can add a question to your question bank.",
  };
}

/** One worded count that links to where the professor acts on it. */
function CountLink({
  count,
  href,
  text,
}: {
  count: number;
  href: string;
  text: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex min-h-11 items-center justify-between gap-3 rounded-panel bg-sheet px-4 py-3 type-body text-ink underline-offset-4 transition-colors duration-fast hover:bg-hover hover:underline focus-ring"
      >
        <span>
          <span className="type-body-strong tabular">{count}</span> {text}
        </span>
        <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-ink-muted" />
      </Link>
    </li>
  );
}

/**
 * Home's content in the order a professor needs it: how it works (until
 * hidden), the next step with three worded counts, the topics waiting for
 * review, recent decisions, and (below 1024, where the page list is in the
 * menu) links to the other pages.
 */
export function ProfessorWorkspaceOverviewPanel({
  overview,
}: {
  overview?: ProfessorWorkspaceOverview;
}) {
  const pipeline = overview?.pipeline;
  const availability = overview?.availability;
  const reviewTopics = overview?.reviewTopics ?? [];
  const recentDecisions = (overview?.recentDecisions ?? []).filter(
    (decision) => decisionLabel(decision) !== null,
  );
  const previewTopics = reviewTopics.slice(0, TOPIC_PREVIEW_LIMIT);
  const remainingTopics = reviewTopics.length - previewTopics.length;
  const next = professorHomeNextStep(overview);
  const nextScheduledAt = realDate(availability?.nextScheduledAt);

  return (
    <div className="flex flex-col gap-10">
      <ProfessorHowItWorks />

      <section
        aria-labelledby="overview-next-heading"
        className="flex flex-col gap-4"
      >
        <div
          data-tour="professor-next-step"
          className="flex flex-col items-start gap-4 rounded-panel bg-sheet p-5 sm:p-6"
        >
          <h2 id="overview-next-heading" className="type-h2 text-ink">
            Next step
          </h2>
          <p className="type-body max-w-prose text-ink">{next.sentence}</p>
          <Button asChild variant="secondary" size="lg" className="min-h-11">
            <Link href={next.href}>{next.label}</Link>
          </Button>
        </div>

        {pipeline && availability ? (
          <>
            <ul
              aria-label="Your questions"
              className="grid gap-2 md:grid-cols-3"
            >
              <CountLink
                count={pipeline.needsReview}
                href={REVIEW_HREF}
                text="waiting for your review"
              />
              <CountLink
                count={pipeline.approvedNotPublished}
                href={APPROVED_HREF}
                text="approved, not yet shown to students"
              />
              <CountLink
                count={availability.available}
                href={STUDENTS_SEE_HREF}
                text="students can see"
              />
            </ul>
            {pipeline.drafts > 0 ? (
              <p className="type-body text-ink">
                <span className="tabular">{pipeline.drafts}</span> being written
              </p>
            ) : null}
            {availability.scheduled > 0 ? (
              <p className="type-body text-ink">
                {nextScheduledAt
                  ? `Next: ${availability.scheduled} ${plural(availability.scheduled, "question becomes", "questions become")} visible to students on ${formatProfessorDate(nextScheduledAt)}.`
                  : `Next: ${availability.scheduled} ${plural(availability.scheduled, "question is", "questions are")} set to become visible to students.`}
              </p>
            ) : null}
          </>
        ) : null}
      </section>

      <section
        aria-labelledby="overview-review-heading"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1">
          <h2 id="overview-review-heading" className="type-h2 text-ink">
            Waiting for you
          </h2>
          {overview && overview.totalNeedsReview > 0 ? (
            <p className="type-body tabular text-ink">
              {overview.totalNeedsReview} waiting in {reviewTopics.length}{" "}
              {plural(reviewTopics.length, "topic", "topics")}
            </p>
          ) : null}
        </div>
        {previewTopics.length > 0 ? (
          <>
            <ul className="flex flex-col divide-y divide-rule rounded-panel bg-sheet px-4">
              {previewTopics.map((topic) => (
                <li
                  key={topic.topicId}
                  className="flex flex-wrap items-center justify-between gap-4 py-3"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="type-body-strong text-ink">
                      {topic.title}
                    </span>
                    <span className="type-body tabular text-ink">
                      {topic.needsReview}{" "}
                      {plural(topic.needsReview, "question", "questions")}{" "}
                      waiting
                    </span>
                  </div>
                  <Button asChild variant="secondary" className="min-h-11">
                    <Link
                      href={`${REVIEW_HREF}?topic=${encodeURIComponent(topic.topicId)}`}
                    >
                      Review this topic
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
            {remainingTopics > 0 ? (
              <Link
                href={REVIEW_HREF}
                className="inline-flex min-h-11 w-fit items-center gap-1 rounded-control type-body text-azure-700 underline underline-offset-4 hover:text-ink focus-ring"
              >
                See all {reviewTopics.length} topics in Review questions
                <ChevronRight aria-hidden="true" className="size-4" />
              </Link>
            ) : null}
          </>
        ) : (
          <EmptyState
            className="py-0"
            action={
              overview ? undefined : (
                <Button asChild variant="secondary" className="min-h-11">
                  <Link href={REVIEW_HREF}>Review questions</Link>
                </Button>
              )
            }
          >
            {overview
              ? "Nothing is waiting for your review right now. New questions will be listed here."
              : "We couldn't load this list just now. Open Review questions to see what is waiting."}
          </EmptyState>
        )}
      </section>

      <section
        aria-labelledby="overview-decisions-heading"
        className="flex flex-col gap-4"
      >
        <h2 id="overview-decisions-heading" className="type-h2 text-ink">
          Recent decisions
        </h2>
        {recentDecisions.length > 0 ? (
          <ul className="flex flex-col divide-y divide-rule rounded-panel bg-sheet px-4">
            {recentDecisions.map((decision) => {
              const when = realDate(decision.occurredAt);
              return (
                <li
                  key={decision.id}
                  className="flex flex-col gap-0.5 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
                >
                  <span className="min-w-0 type-body text-ink">
                    <span className="font-medium">
                      {decisionLabel(decision)}
                    </span>{" "}
                    {decision.kind === "lifecycle" ? (
                      <Link
                        href={professorQuestionPath(decision.questionId)}
                        className="rounded-xs underline underline-offset-4 focus-ring"
                      >
                        {decision.targetTitle}
                      </Link>
                    ) : (
                      decision.targetTitle
                    )}
                  </span>
                  <span className="shrink-0 type-small text-ink-muted">
                    by {decision.actorDisplayName}
                    {when ? (
                      <>
                        ,{" "}
                        <time dateTime={when}>
                          {formatProfessorDateTime(when)}
                        </time>
                      </>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState className="py-0">
            {overview
              ? "Your approvals and other decisions will be listed here."
              : "We couldn't load your recent decisions just now. Reload the page to try again."}
          </EmptyState>
        )}
      </section>

      <section
        aria-labelledby="overview-pages-heading"
        className="flex flex-col gap-3 lg:hidden"
      >
        <h2 id="overview-pages-heading" className="type-h2 text-ink">
          Other pages
        </h2>
        <ul className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
          {PROFESSOR_SECTIONS.filter(
            (section) => section.href !== "/professor",
          ).map((section) => (
            <li key={section.href}>
              <Link
                href={section.href}
                prefetch={section.prefetch}
                className="flex min-h-11 items-center justify-between gap-2 rounded-control type-body text-ink underline-offset-4 transition-colors duration-fast hover:text-azure-700 hover:underline focus-ring"
              >
                {section.label}
                <ChevronRight
                  aria-hidden="true"
                  className="size-4 text-ink-muted"
                />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
