"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ArrowRight, Plus } from "lucide-react";

import { useCoursesStore } from "@/components/courses/courses-store";
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
import { SEED_NOW } from "@/lib/courses/demo-seed";
import { formatRelativeTime } from "@/lib/courses/format";
import { courseSectionPath } from "@/lib/courses/paths";
import { listSections, sectionSummary } from "@/lib/courses/selectors";
import type { CourseId } from "@/lib/courses/types";

function sectionNumber(index: number) {
  return String(index + 1).padStart(2, "0");
}

/** `math-255-fall-2026-sec-03`, bumped until it is free. */
function nextSectionId(courseId: CourseId, taken: Set<string>, count: number) {
  let index = count;
  let id = `${courseId}-sec-${sectionNumber(index)}`;
  while (taken.has(id)) {
    index += 1;
    id = `${courseId}-sec-${sectionNumber(index)}`;
  }
  return id;
}

/**
 * The sections of one course. Each row answers the three questions a professor
 * asks about a section in order: when does it meet, who is in it, and how much
 * of the course has actually reached it.
 */
export function CourseSectionsList({ courseId }: { courseId: CourseId }) {
  const { state, dispatch } = useCoursesStore();
  const [adding, setAdding] = useState(false);

  const sections = listSections(state, courseId);
  const active = sections.filter((section) => section.status === "active");
  const archived = sections.filter((section) => section.status !== "active");

  const [label, setLabel] = useState(`Sec ${sectionNumber(sections.length)}`);
  const [meetingTime, setMeetingTime] = useState("");

  function openForm() {
    setLabel(`Sec ${sectionNumber(sections.length)}`);
    setMeetingTime("");
    setAdding(true);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedLabel = label.trim();
    if (trimmedLabel.length === 0) {
      return;
    }
    dispatch({
      type: "section/create",
      section: {
        id: nextSectionId(
          courseId,
          new Set(state.sections.map((section) => section.id)),
          sections.length,
        ),
        courseId,
        label: trimmedLabel,
        meetingTime: meetingTime.trim(),
      },
      now: SEED_NOW,
    });
    setAdding(false);
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <CardTitle>Sections</CardTitle>
          <CardDescription>
            A section is the scope of everything students see. Students join
            with the code; the roster is hashed keys, never names.
          </CardDescription>
        </div>
        <CardAction>
          <Button
            onClick={() => (adding ? setAdding(false) : openForm())}
            size="sm"
            type="button"
            variant="outline"
          >
            <Plus className="h-4 w-4" />
            Add section
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {adding ? (
          <form
            className="flex flex-wrap items-end gap-3 rounded-md border border-dashed border-border p-4"
            onSubmit={handleSubmit}
          >
            <div className="flex min-w-32 flex-1 flex-col gap-1.5">
              <label
                className="text-sm font-medium"
                htmlFor="new-section-label"
              >
                Label
              </label>
              <Input
                id="new-section-label"
                onChange={(event) => setLabel(event.target.value)}
                value={label}
              />
            </div>
            <div className="flex min-w-40 flex-1 flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="new-section-time">
                Meeting time
              </label>
              <Input
                id="new-section-time"
                onChange={(event) => setMeetingTime(event.target.value)}
                placeholder="MWF 10:00"
                value={meetingTime}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => setAdding(false)}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button type="submit">Add section</Button>
            </div>
            <p className="w-full text-xs leading-5 text-muted-foreground">
              A new section starts closed on every topic and with nothing
              released. Opening it is a deliberate act.
            </p>
          </form>
        ) : null}

        {active.length === 0 && !adding ? (
          <p className="text-sm leading-6 text-muted-foreground">
            No sections yet. Add one to get a join code.
          </p>
        ) : null}

        {active.map((section) => {
          const summary = sectionSummary(state, section.id);
          return (
            <div
              className="flex flex-col gap-1 rounded-md border border-border p-4"
              key={section.id}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium">
                  {section.label}
                  {section.meetingTime ? ` · ${section.meetingTime}` : ""}
                </span>
                <span className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <span>
                    {summary.joined} joined · code{" "}
                    <span className="font-mono">{section.joinCode}</span>
                  </span>
                  <Link
                    className="inline-flex items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline"
                    href={courseSectionPath(courseId, section.id)}
                  >
                    Open
                    <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </Link>
                </span>
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                Topics open {summary.topicsOpen}/{summary.topicsTotal} ·
                Released {summary.released} · Last activity{" "}
                {summary.lastActivityAt
                  ? formatRelativeTime(summary.lastActivityAt, SEED_NOW)
                  : "none yet"}
              </p>
            </div>
          );
        })}

        {archived.map((section) => {
          const summary = sectionSummary(state, section.id);
          return (
            <div
              className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-border border-dashed p-4 text-sm text-muted-foreground"
              key={section.id}
            >
              <span>
                {section.label}
                {section.meetingTime ? ` · ${section.meetingTime}` : ""} ·
                archived
              </span>
              <span>{summary.joined} joined · no longer open to students</span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
