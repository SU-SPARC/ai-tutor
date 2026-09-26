import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { ProfessorTime } from "@/components/professor/professor-question-labels";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type {
  ProfessorWorkspaceDecision,
  ProfessorWorkspaceOverview,
} from "@/lib/professor/workspace-overview";
import { professorQuestionPath } from "@/lib/professor/question-paths";
import type { QuestionLifecycleEventAction } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Past-tense phrasing for the decision history. The lifecycle panel labels the
 * same actions in the imperative because there they are buttons.
 */
const DECISION_LABELS: Record<QuestionLifecycleEventAction, string> = {
  approve: "Approved",
  archive: "Archived",
  create_version: "Created a version of",
  migrate: "Migrated history for",
  publish: "Published",
  regenerate: "Regenerated",
  reject: "Rejected",
  request_revision: "Requested a revision of",
  restore: "Restored",
  rollback: "Rolled back",
  submit: "Submitted for review",
  unpublish: "Unpublished",
};

const RELEASE_DECISION_LABELS = {
  archived: "Archived student access to",
  published: "Released to students",
  unpublished: "Withheld from students",
} as const;

const TOPIC_PREVIEW_LIMIT = 3;

const TOOLS = [
  { href: "/professor/availability", label: "Student availability" },
  { href: "/professor/students", label: "Students", prefetch: false },
  { href: "/professor/analytics", label: "Analytics" },
  { href: "/professor/feedback", label: "Student reports" },
  { href: "/professor/upload", label: "Uploads" },
  { href: "/professor/content-transfer", label: "Import & export" },
] as const;

function decisionLabel(decision: ProfessorWorkspaceDecision) {
  return decision.kind === "lifecycle"
    ? DECISION_LABELS[decision.action]
    : RELEASE_DECISION_LABELS[decision.releaseState];
}

/**
 * One stage of the pipeline strip: the count, the stage name, one line that
 * says what the count means, and the one action for that stage. `emphasis`
 * marks the stage that is waiting on a person.
 */
function PipelineStage({
  action,
  caption,
  count,
  emphasis,
  label,
}: {
  action: React.ReactNode;
  caption: string;
  count?: number;
  emphasis?: boolean;
  label: string;
}) {
  return (
    <li
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-2 rounded-panel p-4",
        emphasis ? "bg-azure-100" : "bg-sheet",
      )}
    >
      <p className="type-label">{label}</p>
      <p
        className={cn(
          "type-metric",
          emphasis ? "text-azure-700" : "text-ink",
        )}
      >
        {count === undefined ? "—" : count}
      </p>
      <p className="type-small text-ink">{caption}</p>
      <div className="mt-auto pt-1">{action}</div>
    </li>
  );
}

function StageLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-8 items-center gap-1 rounded-control type-small text-azure-500 underline-offset-4 transition-colors duration-fast hover:text-azure-700 hover:underline focus-ring"
    >
      {label}
      <ChevronRight aria-hidden="true" className="size-4" />
    </Link>
  );
}

/**
 * The overview's content in the order a professor needs it: the pipeline
 * strip (what needs you, with one action per stage), the topics waiting on
 * review, recent decisions, then the tools. Without an overview (a failed
 * read) the strip still stands, with dashes for the counts, so every section
 * stays one click away.
 */
export function ProfessorWorkspaceOverviewPanel({
  overview,
}: {
  overview?: ProfessorWorkspaceOverview;
}) {
  const pipeline = overview?.pipeline;
  const availability = overview?.availability;
  const reviewTopics = overview?.reviewTopics ?? [];
  const recentDecisions = overview?.recentDecisions ?? [];
  const previewTopics = reviewTopics.slice(0, TOPIC_PREVIEW_LIMIT);
  const remainingTopics = reviewTopics.length - previewTopics.length;

  return (
    <div className="flex flex-col gap-10">
      <section
        aria-labelledby="overview-pipeline-heading"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1">
          <h2 id="overview-pipeline-heading" className="type-h2 text-ink">
            Question pipeline
          </h2>
          <p className="type-small max-w-prose text-ink-muted">
            Approval and student release are separate gates: approving a
            question does not show it to anyone.
          </p>
        </div>
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <PipelineStage
            label="Drafts"
            count={pipeline?.drafts}
            caption="Not yet submitted"
            action={
              <StageLink
                href="/professor/questions?view=draft"
                label="Open drafts"
              />
            }
          />
          <PipelineStage
            label="Needs review"
            count={pipeline?.needsReview}
            caption="Waiting on you"
            emphasis={(pipeline?.needsReview ?? 0) > 0}
            action={
              <Button asChild size="sm">
                <Link href="/professor/review">Start reviewing</Link>
              </Button>
            }
          />
          <PipelineStage
            label="Approved"
            count={pipeline?.approvedNotPublished}
            caption="Not published yet"
            action={
              <StageLink
                href="/professor/questions?view=approved"
                label="Publish approved"
              />
            }
          />
          <PipelineStage
            label="Published"
            count={pipeline?.published}
            caption="Immutable versions in the bank"
            action={
              <StageLink
                href="/professor/questions?view=published"
                label="See published"
              />
            }
          />
          <PipelineStage
            label="Released"
            count={availability?.available}
            caption="Available to students"
            action={
              <StageLink
                href="/professor/availability"
                label="Manage availability"
              />
            }
          />
        </ol>
        <p className="type-caption tabular">
          {pipeline
            ? `${pipeline.reserved} saved for later · ${pipeline.archived} archived`
            : "Counts could not be loaded; every section is still one click away."}
          {availability
            ? ` · ${availability.scheduled} scheduled · ${availability.heldBack} held back`
            : ""}
          {availability?.nextScheduledAt ? (
            <>
              {" · next release "}
              <ProfessorTime value={availability.nextScheduledAt} />
            </>
          ) : null}
        </p>
      </section>

      <section
        aria-labelledby="overview-review-heading"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="overview-review-heading" className="type-h2 text-ink">
            Waiting on your review
          </h2>
          {overview && overview.totalNeedsReview > 0 ? (
            <p className="type-small tabular text-ink-muted">
              {overview.totalNeedsReview} open
              {remainingTopics > 0
                ? ` · ${remainingTopics} more ${remainingTopics === 1 ? "topic" : "topics"} in the queue`
                : ""}
            </p>
          ) : null}
        </div>
        {previewTopics.length > 0 ? (
          <ul className="flex flex-col divide-y divide-rule rounded-panel bg-sheet px-4">
            {previewTopics.map((topic) => (
              <li
                key={topic.topicId}
                className="flex items-center justify-between gap-4 py-3"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="type-body-strong truncate text-ink">
                    {topic.title}
                  </span>
                  <span className="type-caption tabular">
                    {topic.needsReview}{" "}
                    {topic.needsReview === 1 ? "draft" : "drafts"} awaiting a
                    decision
                  </span>
                </div>
                <Button asChild variant="secondary" size="sm">
                  <Link href={`/professor/review?topic=${topic.topicId}`}>
                    Review
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState className="py-0">
            {overview
              ? "Nothing is waiting on your review right now."
              : "The review queue could not be loaded. Open it to try again."}
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
            {recentDecisions.map((decision) => (
              <li
                key={decision.id}
                className="flex flex-col gap-0.5 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
              >
                <span className="min-w-0 type-body text-ink">
                  <span className="font-medium">{decisionLabel(decision)}</span>{" "}
                  {decision.kind === "lifecycle" ? (
                    <Link
                      href={professorQuestionPath(decision.questionId)}
                      className="rounded-xs underline-offset-4 hover:underline focus-ring"
                    >
                      {decision.targetTitle}
                    </Link>
                  ) : (
                    decision.targetTitle
                  )}
                </span>
                <span className="shrink-0 type-caption">
                  {decision.actorDisplayName} ·{" "}
                  <ProfessorTime value={decision.occurredAt} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState className="py-0">
            {overview
              ? "No decisions have been recorded yet."
              : "Decisions could not be loaded."}
          </EmptyState>
        )}
      </section>

      <section
        aria-labelledby="overview-tools-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="overview-tools-heading" className="type-h2 text-ink">
          Tools
        </h2>
        <ul className="grid gap-x-8 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((tool) => (
            <li key={tool.href}>
              <Link
                href={tool.href}
                prefetch={"prefetch" in tool ? tool.prefetch : undefined}
                className="flex min-h-10 items-center justify-between gap-2 rounded-control text-ink underline-offset-4 transition-colors duration-fast hover:text-azure-700 hover:underline focus-ring"
              >
                {tool.label}
                <ChevronRight
                  aria-hidden="true"
                  className="size-4 text-ink-muted"
                />
              </Link>
            </li>
          ))}
        </ul>
        <p className="type-caption max-w-prose">
          Uploaded source files stay on the server; students never see them
          and they are excluded from exports and analytics.
        </p>
      </section>
    </div>
  );
}
