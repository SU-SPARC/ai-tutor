import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { MetricTile } from "@/components/ui/metric-tile";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { courseTopicsPath } from "@/lib/courses/paths";
import type { CoursePipeline, CourseSummary } from "@/lib/courses/selectors";

type Stage = {
  key: string;
  tone: StatusTone;
  label: string;
  count: number;
  caption: string;
  action?: ReactNode;
};

/**
 * S2's headline: the five lifecycle stages as one ordered row of tiles. Each
 * tile is a `MetricTile` (label = the stage's StatusChip, value = the count,
 * caption = what the count means) with at most one action under it. The
 * workspace overview's strip uses the same recipe, so the two read as one
 * pipeline.
 *
 * The fifth stage is the one this feature adds, and it is the whole point:
 * published is not the same as visible to a section.
 */
export function ReleasePipelineStrip({
  courseId,
  pipeline,
  summary,
}: {
  courseId: string;
  pipeline: CoursePipeline;
  summary: CourseSummary;
}) {
  const releasedTotal = pipeline.releasedBySection.reduce(
    (total, section) => total + section.count,
    0,
  );
  const releasable = summary.publishedNotReleased;

  const stages: Stage[] = [
    {
      key: "draft",
      tone: "draft",
      label: "Draft",
      count: pipeline.draft,
      caption: "Imported, not triaged",
    },
    {
      key: "review",
      tone: "review",
      label: "Needs review",
      count: pipeline.needsReview,
      caption: pipeline.needsReview > 0 ? "Waiting on you" : "Nothing waiting",
      action:
        pipeline.needsReview > 0 ? (
          <Button asChild size="sm" variant="secondary">
            <Link href="/professor/review">Review {pipeline.needsReview}</Link>
          </Button>
        ) : undefined,
    },
    {
      key: "approved",
      tone: "approved",
      label: "Approved",
      count: pipeline.approved,
      caption:
        summary.approvedNotPublished > 0
          ? "Publish before you release"
          : "Nothing to publish",
    },
    {
      key: "published",
      tone: "published",
      label: "Published",
      count: pipeline.published,
      caption:
        releasable > 0 ? `${releasable} not released yet` : "All released",
      action:
        releasable > 0 ? (
          <Button asChild size="sm">
            <Link href={courseTopicsPath(courseId)}>Release {releasable}</Link>
          </Button>
        ) : (
          <Button asChild size="sm" variant="ghost">
            <Link href={courseTopicsPath(courseId)}>Open topic builder</Link>
          </Button>
        ),
    },
    {
      key: "released",
      tone: "released",
      label: "Released",
      count: releasedTotal,
      caption:
        pipeline.releasedBySection.length === 0
          ? "No active sections yet"
          : pipeline.releasedBySection
              .map((section) => `${section.label}: ${section.count}`)
              .join(" · "),
    },
  ];

  return (
    <section aria-labelledby="release-pipeline" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="type-h2 text-ink" id="release-pipeline">
          Release pipeline
        </h2>
        <p className="type-small max-w-prose text-ink-muted">
          Published is not the same as visible: a section sees a question only
          after you release it.
        </p>
      </div>
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {stages.map((stage, index) => (
          <li
            className="flex flex-col rounded-panel bg-sheet"
            data-stage={stage.key}
            key={stage.key}
          >
            <MetricTile
              className="bg-transparent"
              delta={stage.caption}
              label={
                <>
                  <span className="sr-only">Stage {index + 1} of 5: </span>
                  <StatusChip label={stage.label} tone={stage.tone} />
                </>
              }
              value={stage.count}
            />
            {stage.action ? (
              <div className="mt-auto px-4 pb-4">{stage.action}</div>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
