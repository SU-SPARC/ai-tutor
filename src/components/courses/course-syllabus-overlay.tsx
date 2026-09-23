"use client";

import Link from "next/link";
import { useState, type KeyboardEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  GripVertical,
} from "lucide-react";

import { useCoursesStore } from "@/components/courses/courses-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { courseTopicsPath } from "@/lib/courses/paths";
import { courseTopicsOrdered, listSections } from "@/lib/courses/selectors";
import type {
  CourseId,
  CoursesState,
  TopicAvailabilityState,
  TopicId,
} from "@/lib/courses/types";
import { cn } from "@/lib/utils";

const TOPIC_STATE_LABEL: Record<TopicAvailabilityState, string> = {
  open: "open",
  closed: "closed",
  scheduled: "scheduled",
};

const TOPIC_STATE_TONE: Record<TopicAvailabilityState, string> = {
  open: "text-success",
  closed: "text-muted-foreground",
  scheduled: "text-warning",
};

/**
 * Only published questions can be released, so the count next to a topic is the
 * count of what is releasable — not everything that exists in the bank.
 */
function publishedCount(state: CoursesState, topicId: TopicId) {
  return state.bank.filter(
    (question) =>
      question.topicId === topicId && question.state === "published",
  ).length;
}

/**
 * The course's opinion about the canonical syllabus: which topics it includes,
 * in what order, under what label. The canonical topic itself is never touched,
 * which is why the original title stays visible under a renamed row.
 */
export function CourseSyllabusOverlay({ courseId }: { courseId: CourseId }) {
  const { state, dispatch } = useCoursesStore();
  const [editing, setEditing] = useState<TopicId | null>(null);

  const rows = courseTopicsOrdered(state, courseId);
  const included = rows.filter((row) => row.overlay.included);
  const excluded = rows.filter((row) => !row.overlay.included);
  const firstSection = listSections(state, courseId).find(
    (section) => section.status === "active",
  );

  const topicState = (topicId: TopicId): TopicAvailabilityState =>
    (firstSection &&
      state.topicAvailability.find(
        (row) => row.sectionId === firstSection.id && row.topicId === topicId,
      )?.state) ||
    "closed";

  /**
   * Moving past an excluded topic would look like nothing happened, because
   * excluded rows render below the divider. So a move steps over them until the
   * visible order actually changes.
   */
  function move(topicId: TopicId, direction: "up" | "down") {
    const ordered = state.courseTopics
      .filter((row) => row.courseId === courseId)
      .sort((left, right) => left.position - right.position);
    const index = ordered.findIndex((row) => row.topicId === topicId);
    if (index < 0) {
      return;
    }
    const step = direction === "up" ? -1 : 1;
    let target = index + step;
    while (
      target >= 0 &&
      target < ordered.length &&
      !ordered[target].included
    ) {
      target += step;
    }
    if (target < 0 || target >= ordered.length) {
      return;
    }
    const steps = Math.abs(target - index);
    for (let step_ = 0; step_ < steps; step_ += 1) {
      dispatch({ type: "course/moveTopic", courseId, topicId, direction });
    }
  }

  function rename(topicId: TopicId, value: string) {
    const trimmed = value.trim();
    dispatch({
      type: "course/updateTopic",
      courseId,
      topicId,
      patch: { displayLabel: trimmed.length === 0 ? null : trimmed },
    });
    setEditing(null);
  }

  function setIncluded(topicId: TopicId, next: boolean) {
    dispatch({
      type: "course/updateTopic",
      courseId,
      topicId,
      patch: { included: next },
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <CardTitle>Syllabus</CardTitle>
          <CardDescription>
            An overlay on the canonical topics: order and labels belong to this
            course, the topics themselves never change. Counts are published
            questions; open, closed, and scheduled are for{" "}
            {firstSection ? firstSection.label : "the first section"}.
          </CardDescription>
        </div>
        <CardAction>
          <Button asChild size="sm" variant="outline">
            <Link href={courseTopicsPath(courseId)}>
              Edit topics
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col pt-0">
        <ul className="flex flex-col">
          {included.map((row, index) => {
            const label = row.overlay.displayLabel ?? row.topic.title;
            const renamed =
              row.overlay.displayLabel !== null &&
              row.overlay.displayLabel !== row.topic.title;
            const availability = topicState(row.topic.id);

            return (
              <li
                className="flex flex-wrap items-center gap-3 border-b border-border py-2.5 last:border-b-0"
                key={row.topic.id}
              >
                <GripVertical
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-muted-foreground/60"
                />
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    aria-label={`Move ${label} up`}
                    className="h-7 w-7"
                    disabled={index === 0}
                    onClick={() => move(row.topic.id, "up")}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    aria-label={`Move ${label} down`}
                    className="h-7 w-7"
                    disabled={index === included.length - 1}
                    onClick={() => move(row.topic.id, "down")}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </div>
                <Badge className="shrink-0" variant="outline">
                  Wk{row.topic.weekNumber}
                </Badge>

                <div className="flex min-w-48 flex-1 flex-col gap-0.5">
                  {editing === row.topic.id ? (
                    <Input
                      aria-label={`Display label for ${row.topic.title}`}
                      autoFocus
                      className="h-8"
                      defaultValue={label}
                      onBlur={(event) =>
                        rename(row.topic.id, event.target.value)
                      }
                      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          rename(row.topic.id, event.currentTarget.value);
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          // Blur would otherwise save on the way out.
                          event.currentTarget.value = label;
                          setEditing(null);
                        }
                      }}
                    />
                  ) : (
                    <button
                      className="rounded-sm text-left text-sm font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      onClick={() => setEditing(row.topic.id)}
                      title={row.topic.title}
                      type="button"
                    >
                      {label}
                    </button>
                  )}
                  {renamed ? (
                    <span className="text-xs text-muted-foreground">
                      {row.topic.title}
                    </span>
                  ) : null}
                </div>

                <span className="shrink-0 text-sm text-muted-foreground">
                  {publishedCount(state, row.topic.id)} q ·{" "}
                  <span className={cn(TOPIC_STATE_TONE[availability])}>
                    {TOPIC_STATE_LABEL[availability]}
                  </span>
                </span>
                <Button
                  className="shrink-0 text-muted-foreground"
                  onClick={() => setIncluded(row.topic.id, false)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Exclude
                </Button>
              </li>
            );
          })}
        </ul>

        {excluded.length > 0 ? (
          <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
            <p className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              <AlertTriangle
                aria-hidden="true"
                className="h-4 w-4 text-warning"
              />
              Excluded ({excluded.length})
            </p>
            <ul className="flex flex-col">
              {excluded.map((row) => (
                <li
                  className="flex flex-wrap items-center gap-3 py-2 text-sm text-muted-foreground"
                  key={row.topic.id}
                >
                  <Badge className="shrink-0" variant="outline">
                    Wk{row.topic.weekNumber}
                  </Badge>
                  <span className="flex-1" title={row.topic.title}>
                    {row.overlay.displayLabel ?? row.topic.title}
                  </span>
                  <span>
                    {publishedCount(state, row.topic.id)} q · not in this course
                  </span>
                  <Button
                    onClick={() => setIncluded(row.topic.id, true)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Include
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
