import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { courseTopicsPath } from "@/lib/courses/paths";
import type { CoursePipeline, CourseSummary } from "@/lib/courses/selectors";
import { cn } from "@/lib/utils";

/**
 * One stage of the strip. `emphasis` marks a stage that is waiting on a person;
 * everything else is reporting a settled state.
 */
function Stage({
  caption,
  children,
  count,
  emphasis,
  label,
  tone,
}: {
  caption: string;
  children?: ReactNode;
  count: number;
  emphasis?: boolean;
  label: string;
  tone?: "success";
}) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-1.5 rounded-md p-4",
        emphasis && "border border-primary/25 bg-accent",
      )}
    >
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            "text-3xl leading-none font-semibold tracking-tight",
            emphasis && "text-primary",
            !emphasis && tone === "success" && "text-success",
          )}
        >
          {count}
        </span>
        <span
          className={cn(
            "text-xs font-medium text-muted-foreground",
            emphasis && "text-accent-foreground",
          )}
        >
          {label}
        </span>
      </div>
      <div
        className={cn(
          "text-sm font-medium",
          emphasis && "text-accent-foreground",
        )}
      >
        {caption}
      </div>
      {children}
    </div>
  );
}

function Arrow() {
  return (
    <ChevronRight
      aria-hidden="true"
      className="hidden h-4 w-4 self-center text-border lg:block"
    />
  );
}

/**
 * S2's headline. The four lifecycle stages come straight from the professor
 * hub; the fifth is the one this feature adds, and it is the whole point:
 * published is not the same as visible to my Tuesday section.
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Release pipeline</CardTitle>
        <CardDescription>
          Where every question in this course sits. Approve, publish, and
          release are three separate gates: published is not the same as visible
          to a section.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-col gap-1 lg:flex-row lg:items-stretch">
          <Stage
            caption="Imported, untriaged"
            count={pipeline.draft}
            label="draft"
          />
          <Arrow />
          <Stage
            caption="Waiting on you"
            count={pipeline.needsReview}
            emphasis
            label="needs review"
          />
          <Arrow />
          <Stage
            caption="Not published yet"
            count={pipeline.approved}
            emphasis
            label="approved"
          />
          <Arrow />
          <Stage
            caption="Immutable versions"
            count={pipeline.published}
            label="published"
          />
          <Arrow />
          <Stage
            caption="Released to students"
            count={releasedTotal}
            label="released"
            tone="success"
          >
            <p className="text-xs leading-5 text-muted-foreground">
              {pipeline.releasedBySection.length === 0
                ? "No active sections yet"
                : `to ${pipeline.releasedBySection
                    .map((section) => `${section.label}: ${section.count}`)
                    .join(" · ")}`}
            </p>
          </Stage>
        </div>
      </CardContent>
      <CardFooter className="flex-col items-start gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="outline">
            <Link href="/professor/review">
              Review {pipeline.needsReview} →
            </Link>
          </Button>
          {releasable > 0 ? (
            <Button asChild>
              <Link href={courseTopicsPath(courseId)}>
                Release {releasable} published →
              </Link>
            </Button>
          ) : (
            <Button asChild variant="secondary">
              <Link href={courseTopicsPath(courseId)}>
                Everything published is released →
              </Link>
            </Button>
          )}
        </div>
        {summary.approvedNotPublished > 0 ? (
          <p className="text-xs leading-5 text-muted-foreground">
            {summary.approvedNotPublished} approved{" "}
            {summary.approvedNotPublished === 1
              ? "question still needs"
              : "questions still need"}{" "}
            publishing before they can be released.
          </p>
        ) : null}
      </CardFooter>
    </Card>
  );
}
