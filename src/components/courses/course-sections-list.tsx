"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Archive, Copy, Plus } from "lucide-react";

import {
  plural,
  sectionLabelText,
} from "@/components/courses/course-status";
import { useCoursesStore } from "@/components/courses/courses-store";
import { copyJoinCode } from "@/components/courses/join-code-panel";
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
import { courseSectionPath, courseTopicsPath } from "@/lib/courses/paths";
import { coursesReducer } from "@/lib/courses/reducer";
import {
  getSection,
  listSections,
  sectionSummary,
} from "@/lib/courses/selectors";
import type { CourseId, CourseSection } from "@/lib/courses/types";

function sectionNumber(index: number) {
  return String(index + 1).padStart(2, "0");
}

/** `math-255-fall-2026-sec-03`, bumped until it is free. */
export function nextSectionId(
  courseId: CourseId,
  taken: Set<string>,
  count: number,
) {
  let index = count;
  let id = `${courseId}-sec-${sectionNumber(index)}`;
  while (taken.has(id)) {
    index += 1;
    id = `${courseId}-sec-${sectionNumber(index)}`;
  }
  return id;
}

/**
 * The sections of one course: the first thing on the course page, because
 * the join code is what a professor needs on day one. Five columns: the
 * section (with its meeting time under the name), the join code with a Copy
 * button, students, questions shown, and last activity.
 */
export function CourseSectionsList({ courseId }: { courseId: CourseId }) {
  const { state, dispatch } = useCoursesStore();
  const [adding, setAdding] = useState(false);

  const sections = listSections(state, courseId);
  const active = sections.filter((section) => section.status === "active");
  const archived = sections.filter((section) => section.status !== "active");

  const [label, setLabel] = useState(`Section ${sections.length + 1}`);
  const [meetingTime, setMeetingTime] = useState("");
  const [labelError, setLabelError] = useState<string | undefined>();

  function openForm() {
    setLabel(`Section ${sections.length + 1}`);
    setMeetingTime("");
    setLabelError(undefined);
    setAdding(true);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedLabel = label.trim();
    if (trimmedLabel.length === 0) {
      setLabelError("Give the section a name, for example Section 3.");
      return;
    }
    const id = nextSectionId(
      courseId,
      new Set(state.sections.map((section) => section.id)),
      sections.length,
    );
    const action = {
      type: "section/create",
      section: {
        id,
        courseId,
        label: trimmedLabel,
        meetingTime: meetingTime.trim(),
      },
      now: SEED_NOW,
    } as const;
    // The reducer is pure, so the new join code is known before it is stored.
    const joinCode = getSection(coursesReducer(state, action), id)?.joinCode;
    dispatch(action);
    setAdding(false);
    toast({
      title: joinCode
        ? `${sectionLabelText(trimmedLabel)} added. Its join code is ${joinCode}.`
        : `${sectionLabelText(trimmedLabel)} added.`,
      description:
        "Next: choose which questions this section sees. Every week starts closed to students.",
      tone: "success",
    });
  }

  function restore(section: CourseSection) {
    dispatch({
      type: "section/update",
      sectionId: section.id,
      patch: { status: "active" },
    });
    toast({
      title: `${sectionLabelText(section)} is restored. Students can join again.`,
      tone: "success",
      action: {
        label: "Undo",
        onClick: () =>
          dispatch({
            type: "section/update",
            sectionId: section.id,
            patch: { status: "archived" },
          }),
      },
      duration: 15_000,
    });
  }

  return (
    <section aria-labelledby="course-sections" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="type-h2 text-ink" id="course-sections">
            Sections
          </h2>
          <p className="type-body max-w-prose text-ink-muted">
            {active.length === 0
              ? "Add a section to get a join code for your students."
              : `${plural(active.length, "section")}. Each has its own join code; read it to your class.`}
          </p>
        </div>
        <Button
          aria-controls="add-section-form"
          aria-expanded={adding}
          className="min-h-11"
          onClick={() => (adding ? setAdding(false) : openForm())}
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
            <Field
              error={labelError}
              label="Section name, e.g. Section 1 or Tue/Thu 10am"
            >
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
            <Field label="Meeting time, e.g. MWF 10:00" optional>
              <Input
                autoComplete="off"
                name="meetingTime"
                onChange={(event) => setMeetingTime(event.target.value)}
                placeholder="MWF 10:00"
                value={meetingTime}
              />
            </Field>
          </div>
          <p className="type-body text-ink">
            Next: choose which questions this section sees.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button className="min-h-11" type="submit">
              Add section
            </Button>
            <Button
              className="min-h-11"
              onClick={() => setAdding(false)}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      <div className="rounded-panel bg-sheet px-2 pb-2">
        <Table>
          <TableCaption className="type-small px-3 text-left">
            Students appear as private codes, not names, to protect their
            privacy.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Section</TableHead>
              <TableHead scope="col">Join code</TableHead>
              <TableHead numeric scope="col">
                Students
              </TableHead>
              <TableHead numeric scope="col">
                Questions shown
              </TableHead>
              <TableHead scope="col">Last activity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sections.length === 0 ? (
              <TableRow>
                <TableCell className="py-4 text-ink-muted" colSpan={5}>
                  No sections yet. Add one to get a join code.
                </TableCell>
              </TableRow>
            ) : null}
            {active.map((section) => {
              const summary = sectionSummary(state, section.id);
              const name = sectionLabelText(section);
              return (
                <TableRow key={section.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <Link
                        className="type-body inline-flex min-h-11 w-fit items-center rounded-xs text-azure-500 underline-offset-4 hover:text-azure-700 hover:underline focus-ring"
                        href={courseSectionPath(courseId, section.id)}
                      >
                        {name}
                      </Link>
                      {section.meetingTime ? (
                        <span className="type-small text-ink-muted">
                          {section.meetingTime}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="type-mono-input text-ink">
                        {section.joinCode}
                      </span>
                      <Button
                        aria-label={`Copy the join code for ${name}`}
                        className="min-h-11"
                        onClick={() => void copyJoinCode(section.joinCode, name)}
                        type="button"
                        variant="outline"
                      >
                        <Copy aria-hidden="true" />
                        Copy
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell numeric>{summary.joined}</TableCell>
                  <TableCell numeric>
                    {summary.released === 0 ? (
                      <Link
                        className="inline-flex min-h-11 items-center rounded-xs text-azure-500 underline underline-offset-2 hover:text-azure-700 focus-ring"
                        href={courseTopicsPath(courseId, section.id)}
                      >
                        None yet: choose
                      </Link>
                    ) : (
                      summary.released
                    )}
                  </TableCell>
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
              const name = sectionLabelText(section);
              return (
                <TableRow className="text-ink-muted" key={section.id}>
                  <TableCell className="text-ink-muted">
                    <div className="flex flex-col">
                      <span className="type-body">{name}</span>
                      {section.meetingTime ? (
                        <span className="type-small">{section.meetingTime}</span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip
                        icon={Archive}
                        label="Archived: students can't join"
                        tone="neutral"
                      />
                      <Button
                        aria-label={`Restore ${name}`}
                        className="min-h-11"
                        onClick={() => restore(section)}
                        type="button"
                        variant="outline"
                      >
                        Restore
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="text-ink-muted" numeric>
                    {summary.joined}
                  </TableCell>
                  <TableCell className="text-ink-muted" numeric>
                    —
                  </TableCell>
                  <TableCell className="text-ink-muted">—</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
