"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { sectionLabelText } from "@/components/courses/course-status";
import { Button } from "@/components/ui/button";
import { MetricTile } from "@/components/ui/metric-tile";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { courseTopicsPath } from "@/lib/courses/paths";
import type { CoursePipeline, CourseSummary } from "@/lib/courses/selectors";
import { cn } from "@/lib/utils";

type Stage = {
  key: string;
  tone: StatusTone;
  label: string;
  count: number;
  caption: string;
  action?: ReactNode;
};

/**
 * "Question status": how many of this course's questions are at each step,
 * from being written to shown to students. It is reference, not the next
 * step, so it sits last on the course page and starts folded away. Each tile
 * is a `MetricTile` (label = the status chip, value = the count, caption =
 * what the count means) with at most one action under it.
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
  const [open, setOpen] = useState(false);
  const shownTotal = pipeline.releasedBySection.reduce(
    (total, section) => total + section.count,
    0,
  );
  const ready = summary.publishedNotReleased;

  const stages: Stage[] = [
    {
      key: "draft",
      tone: "draft",
      label: "Being written",
      count: pipeline.draft,
      caption: "Not checked yet",
    },
    {
      key: "review",
      tone: "review",
      label: "Waiting for your review",
      count: pipeline.needsReview,
      caption:
        pipeline.needsReview > 0 ? "Waiting for your approval" : "Nothing waiting",
      action:
        pipeline.needsReview > 0 ? (
          <Button asChild className="min-h-11" variant="secondary">
            <Link href="/professor/review">Review questions</Link>
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
          ? "Approved: make them ready to use"
          : "Approved",
    },
    {
      key: "published",
      tone: "published",
      label: "Ready to use",
      count: pipeline.published,
      caption:
        ready > 0
          ? `Ready: ${ready} not shown to any section yet`
          : "All shown to a section",
      action: (
        <Button asChild className="min-h-11" variant="secondary">
          <Link href={courseTopicsPath(courseId)}>
            Choose questions for students
          </Link>
        </Button>
      ),
    },
    {
      key: "released",
      tone: "released",
      label: "Shown to students",
      count: shownTotal,
      caption:
        pipeline.releasedBySection.length === 0
          ? "No sections yet"
          : pipeline.releasedBySection
              .map(
                (section) =>
                  `${sectionLabelText(section.label)}: ${section.count}`,
              )
              .join(" · "),
    },
  ];

  return (
    <section aria-labelledby="question-status" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="type-h2 text-ink" id="question-status">
          <button
            aria-controls="question-status-tiles"
            aria-expanded={open}
            className="-mx-2 inline-flex min-h-11 items-center gap-2 rounded-control px-2 transition-colors duration-fast hover:bg-hover focus-ring"
            onClick={() => setOpen((current) => !current)}
            type="button"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "size-5 text-ink-muted transition-transform duration-fast ease-out",
                open && "rotate-90",
              )}
            />
            Question status
          </button>
        </h2>
        <p className="type-body max-w-prose text-ink-muted">
          {ready > 0
            ? `${ready} ${ready === 1 ? "question is" : "questions are"} ready but not shown to students.`
            : "Where this course's questions are, from being written to shown to students."}
        </p>
      </div>
      {open ? (
        <ol
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
          id="question-status-tiles"
        >
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
                    <span className="sr-only">Step {index + 1} of 5: </span>
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
      ) : null}
    </section>
  );
}
