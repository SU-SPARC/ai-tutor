"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Archive, Plus } from "lucide-react";

import { useCoursesStore } from "@/components/courses/courses-store";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
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
 * The sections of one course as a dense table. Each row answers the questions
 * a professor asks about a section in order: when it meets, the code students
 * type, who is in it, and how much of the course has reached it.
 */
export function CourseSectionsList({ courseId }: { courseId: CourseId }) {
  const { state, dispatch } = useCoursesStore();
  const [adding, setAdding] = useState(false);

  const sections = listSections(state, courseId);
  const active = sections.filter((section) => section.status === "active");
  const archived = sections.filter((section) => section.status !== "active");

  const [label, setLabel] = useState(`Sec ${sectionNumber(sections.length)}`);
  const [meetingTime, setMeetingTime] = useState("");
  const [labelError, setLabelError] = useState<string | undefined>();

  function openForm() {
    setLabel(`Sec ${sectionNumber(sections.length)}`);
    setMeetingTime("");
    setLabelError(undefined);
    setAdding(true);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedLabel = label.trim();
    if (trimmedLabel.length === 0) {
      setLabelError("Give the section a label, for example Sec 03.");
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
    toast({
      title: `${trimmedLabel} added`,
      description: "Every topic starts closed. Open them in the topic builder.",
      tone: "success",
    });
  }

  return (
    <section aria-labelledby="course-sections" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="type-h2 text-ink" id="course-sections">
          Sections{" "}
          <span className="type-mono align-middle text-ink-muted">
            {active.length}
          </span>
        </h2>
        <Button
          aria-controls="add-section-form"
          aria-expanded={adding}
          onClick={() => (adding ? setAdding(false) : openForm())}
          size="sm"
          type="button"
          variant="secondary"
        >
          <Plus aria-hidden="true" />
          Add section
        </Button>
      </div>

      {adding ? (
        <form
          className="flex flex-col gap-3 rounded-panel bg-surface-tint p-4"
          id="add-section-form"
          noValidate
          onSubmit={handleSubmit}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field error={labelError} label="Label">
              <Input
                autoComplete="off"
                name="label"
                onChange={(event) => {
                  setLabel(event.target.value);
                  setLabelError(undefined);
                }}
                value={label}
              />
            </Field>
            <Field label="Meeting time" optional>
              <Input
                autoComplete="off"
                name="meetingTime"
                onChange={(event) => setMeetingTime(event.target.value)}
                placeholder="MWF 10:00…"
                value={meetingTime}
              />
            </Field>
          </div>
          <p className="type-small text-ink-muted">
            A new section starts with every topic closed and nothing released.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit">Add section</Button>
            <Button onClick={() => setAdding(false)} type="button" variant="ghost">
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      <div className="rounded-panel bg-sheet px-2 pb-2">
        <Table>
          <TableCaption className="px-3 text-left">
            Students join with the code. The roster shows hashed codes, never
            names.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Section</TableHead>
              <TableHead scope="col">Meets</TableHead>
              <TableHead scope="col">Join code</TableHead>
              <TableHead numeric scope="col">
                Joined
              </TableHead>
              <TableHead numeric scope="col">
                Topics open
              </TableHead>
              <TableHead numeric scope="col">
                Released
              </TableHead>
              <TableHead scope="col">Last activity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sections.length === 0 ? (
              <TableRow>
                <TableCell className="py-4 text-ink-muted" colSpan={7}>
                  No sections yet. Add one to get a join code.
                </TableCell>
              </TableRow>
            ) : null}
            {active.map((section) => {
              const summary = sectionSummary(state, section.id);
              return (
                <TableRow key={section.id}>
                  <TableCell>
                    <Link
                      className="rounded-xs text-azure-500 underline-offset-4 hover:text-azure-700 hover:underline focus-ring"
                      href={courseSectionPath(courseId, section.id)}
                    >
                      {section.label}
                    </Link>
                  </TableCell>
                  <TableCell className="text-ink-muted">
                    {section.meetingTime || "—"}
                  </TableCell>
                  <TableCell>
                    <span className="type-mono text-ink">{section.joinCode}</span>
                  </TableCell>
                  <TableCell numeric>{summary.joined}</TableCell>
                  <TableCell numeric>
                    {summary.topicsOpen} of {summary.topicsTotal}
                  </TableCell>
                  <TableCell numeric>{summary.released}</TableCell>
                  <TableCell className="whitespace-nowrap text-ink-muted">
                    {summary.lastActivityAt
                      ? formatRelativeTime(summary.lastActivityAt, SEED_NOW)
                      : "None yet"}
                  </TableCell>
                </TableRow>
              );
            })}
            {archived.map((section) => {
              const summary = sectionSummary(state, section.id);
              return (
                <TableRow className="text-ink-muted" key={section.id}>
                  <TableCell className="text-ink-muted">{section.label}</TableCell>
                  <TableCell className="text-ink-muted">
                    {section.meetingTime || "—"}
                  </TableCell>
                  <TableCell>
                    <StatusChip icon={Archive} label="Archived" tone="neutral" />
                  </TableCell>
                  <TableCell className="text-ink-muted" numeric>
                    {summary.joined}
                  </TableCell>
                  <TableCell className="text-ink-muted" numeric>
                    —
                  </TableCell>
                  <TableCell className="text-ink-muted" numeric>
                    —
                  </TableCell>
                  <TableCell className="text-ink-muted">Closed to joins</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
