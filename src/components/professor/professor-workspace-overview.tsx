import Link from "next/link";
import {
  BarChart3,
  CalendarClock,
  ChevronRight,
  ClipboardCheck,
  FileJson,
  ShieldCheck,
  Upload,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  ProfessorWorkspaceDecision,
  ProfessorWorkspaceOverview,
} from "@/lib/professor/workspace-overview";
import type { QuestionLifecycleEventAction } from "@/lib/types";

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

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function decisionLabel(decision: ProfessorWorkspaceDecision) {
  return decision.kind === "lifecycle"
    ? DECISION_LABELS[decision.action]
    : RELEASE_DECISION_LABELS[decision.releaseState];
}

/**
 * One stage of the pipeline strip. `emphasis` marks the two stages that are
 * waiting on a person rather than reporting a settled state.
 */
function PipelineStage({
  caption,
  count,
  emphasis,
  label,
  tone,
}: {
  caption: string;
  count: number;
  emphasis?: boolean;
  label: string;
  tone?: "success";
}) {
  return (
    <div
      className={
        emphasis
          ? "flex flex-1 flex-col gap-1.5 rounded-md border border-primary/25 bg-accent p-4"
          : "flex flex-1 flex-col gap-1.5 rounded-md p-4"
      }
    >
      <div className="flex items-baseline gap-2">
        <span
          className={
            emphasis
              ? "text-3xl leading-none font-semibold tracking-tight text-primary"
              : tone === "success"
                ? "text-3xl leading-none font-semibold tracking-tight text-success"
                : "text-3xl leading-none font-semibold tracking-tight"
          }
        >
          {count}
        </span>
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="text-sm font-medium">{caption}</div>
    </div>
  );
}

function PipelineArrow() {
  return (
    <ChevronRight
      aria-hidden="true"
      className="hidden h-4 w-4 self-center text-border lg:block"
    />
  );
}

export function ProfessorWorkspaceOverviewPanel({
  overview,
}: {
  overview: ProfessorWorkspaceOverview;
}) {
  const { availability, pipeline, recentDecisions, reviewTopics } = overview;
  const previewTopics = reviewTopics.slice(0, TOPIC_PREVIEW_LIMIT);
  const remainingTopics = reviewTopics.length - previewTopics.length;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Question pipeline</CardTitle>
            <CardDescription>
              Where the catalog currently sits. Approval and student release are
              separate gates: approving content does not expose it.
            </CardDescription>
          </div>
          <Button asChild variant="link" className="h-auto px-0">
            <Link href="/professor/questions">Full lifecycle view</Link>
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-col gap-1 lg:flex-row lg:items-stretch">
            <PipelineStage
              caption="Imported, untriaged"
              count={pipeline.drafts}
              label="drafts"
            />
            <PipelineArrow />
            <PipelineStage
              caption="Waiting on you"
              count={pipeline.needsReview}
              emphasis={pipeline.needsReview > 0}
              label="in review"
            />
            <PipelineArrow />
            <PipelineStage
              caption="Not published yet"
              count={pipeline.approvedNotPublished}
              emphasis={pipeline.approvedNotPublished > 0}
              label="approved"
            />
            <PipelineArrow />
            <PipelineStage
              caption="Immutable versions"
              count={pipeline.published}
              label="published"
            />
            <PipelineArrow />
            <PipelineStage
              caption="Available to students"
              count={availability.available}
              label="live"
              tone={availability.available > 0 ? "success" : undefined}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck
                  aria-hidden="true"
                  className="h-4 w-4 text-primary"
                />
                Waiting on your review
              </CardTitle>
              <CardDescription>
                Questions are shown one at a time, in syllabus order. Your
                decision is recorded against your account.
              </CardDescription>
            </div>
            {overview.totalNeedsReview > 0 ? (
              <Badge className="shrink-0">
                {overview.totalNeedsReview} open
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {previewTopics.length > 0 ? (
              <ul className="flex flex-col divide-y">
                {previewTopics.map((topic) => (
                  <li
                    key={topic.topicId}
                    className="flex items-center justify-between gap-4 py-3 first:pt-0"
                  >
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{topic.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {topic.needsReview}{" "}
                        {topic.needsReview === 1 ? "draft" : "drafts"} awaiting
                        a decision
                      </span>
                    </div>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/professor/review?topic=${topic.topicId}`}>
                        Review
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing is waiting on your review right now.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button asChild>
                <Link href="/professor/review">Open the review queue</Link>
              </Button>
              {remainingTopics > 0 ? (
                <span className="text-xs text-muted-foreground">
                  and {remainingTopics} more{" "}
                  {remainingTopics === 1 ? "topic" : "topics"}
                </span>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock
                aria-hidden="true"
                className="h-4 w-4 text-primary"
              />
              Student availability
            </CardTitle>
            <CardDescription>
              A release gate, separate from approval. Availability is global —
              the data model has no cohorts.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            <dl className="flex flex-col gap-2.5 text-sm">
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full bg-success"
                />
                <dt className="flex-1">Available now</dt>
                <dd className="font-semibold">{availability.available}</dd>
              </div>
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full bg-warning"
                />
                <dt className="flex-1">Scheduled</dt>
                <dd className="font-semibold">{availability.scheduled}</dd>
              </div>
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full bg-input"
                />
                <dt className="flex-1">Held back</dt>
                <dd className="font-semibold">{availability.heldBack}</dd>
              </div>
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full bg-border"
                />
                <dt className="flex-1">Archived</dt>
                <dd className="font-semibold">{availability.archived}</dd>
              </div>
            </dl>

            {availability.nextScheduledAt ? (
              <p className="rounded-md bg-muted px-3.5 py-3 text-xs leading-5 text-muted-foreground">
                Next scheduled release —{" "}
                <span className="font-medium text-foreground">
                  {formatDate(availability.nextScheduledAt)}
                </span>
                .
              </p>
            ) : null}

            <Button asChild variant="outline" className="mt-auto w-full">
              <Link href="/professor/availability">Manage availability</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent decisions</CardTitle>
            <CardDescription>
              Review, publication, and release changes, attributed to the
              account that made them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recentDecisions.length > 0 ? (
              <ul className="flex flex-col divide-y">
                {recentDecisions.map((decision) => (
                  <li
                    key={decision.id}
                    className="flex items-center justify-between gap-4 py-3 first:pt-0"
                  >
                    <span className="text-sm">
                      <span className="font-medium">
                        {decisionLabel(decision)}
                      </span>{" "}
                      {decision.targetTitle}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {decision.actorDisplayName} ·{" "}
                      {formatDate(decision.occurredAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No decisions have been recorded yet.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Course tools</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              <Button
                asChild
                variant="ghost"
                className="h-auto justify-start gap-3 px-3 py-2.5"
              >
                <Link href="/professor/analytics">
                  <BarChart3
                    aria-hidden="true"
                    className="h-4 w-4 text-muted-foreground"
                  />
                  <span className="flex-1 text-left">Analytics</span>
                  <ChevronRight
                    aria-hidden="true"
                    className="h-4 w-4 text-muted-foreground"
                  />
                </Link>
              </Button>
              <Button
                asChild
                variant="ghost"
                className="h-auto justify-start gap-3 px-3 py-2.5"
              >
                <Link href="/professor/upload">
                  <Upload
                    aria-hidden="true"
                    className="h-4 w-4 text-muted-foreground"
                  />
                  <span className="flex-1 text-left">Upload preview</span>
                  <ChevronRight
                    aria-hidden="true"
                    className="h-4 w-4 text-muted-foreground"
                  />
                </Link>
              </Button>
              <Button
                asChild
                variant="ghost"
                className="h-auto justify-start gap-3 px-3 py-2.5"
              >
                <Link href="/professor/content-transfer">
                  <FileJson
                    aria-hidden="true"
                    className="h-4 w-4 text-muted-foreground"
                  />
                  <span className="flex-1 text-left">Import &amp; export</span>
                  <ChevronRight
                    aria-hidden="true"
                    className="h-4 w-4 text-muted-foreground"
                  />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShieldCheck
                  aria-hidden="true"
                  className="h-4 w-4 text-success"
                />
                Private material excluded
              </CardTitle>
              <CardDescription>
                Uploaded source files stay on the server. Students never see
                them, and they are excluded from exports and analytics.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    </div>
  );
}
