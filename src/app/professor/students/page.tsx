import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { InstructorStudentTable } from "@/components/professor/instructor-student-table";
import { InstructorStudentTopicRoster } from "@/components/professor/instructor-student-topic-roster";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { LinkTab, LinkTabs } from "@/components/ui/tabs";
import {
  requireAnalyticsAccess,
  requirePageAccess,
} from "@/lib/auth/authorization";
import { listInstructorStudents } from "@/lib/data/data-store";
import { getServerEnv } from "@/lib/env/server";
import { pilotRequestId } from "@/lib/observability/pilot-operations";
import {
  resolveInstructorStudentIdentities,
  resolveInstructorStudentRoster,
} from "@/lib/professor/student-identity";
import type { InstructorStudentSort } from "@/lib/types";

export const metadata: Metadata = {
  title: "Students",
};

const SORTS: InstructorStudentSort[] = [
  "last_active",
  "lowest_accuracy",
  "attempts",
  "sessions",
];

/**
 * Two readings of the same class: the activity table, sortable and searchable
 * by student code, and the roster grouped by practiced topic. Both show the
 * students' usernames, resolved on the server for the signed-in professor and
 * recorded before they are rendered; see `resolveInstructorStudentRoster`.
 */
const VIEWS = ["activity", "topics"] as const;

type StudentsView = (typeof VIEWS)[number];

const PAGE_SIZE = 25;

function parseSort(value: string | undefined): InstructorStudentSort {
  return SORTS.find((sort) => sort === value) ?? "last_active";
}

function parseView(value: string | undefined): StudentsView {
  return VIEWS.find((view) => view === value) ?? "activity";
}

function parsePage(value: string | undefined) {
  const page = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

export default async function ProfessorStudentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const authorization = await requirePageAccess(
    requireAnalyticsAccess,
    "/professor/students",
  );
  const params = await searchParams;
  const view = parseView(
    typeof params.view === "string" ? params.view : undefined,
  );

  // One correlation id per render, shared by every audit row it writes.
  const requestId = pilotRequestId();

  if (view === "topics") {
    const roster = await resolveInstructorStudentRoster(authorization, {
      requestId,
    });
    const empty = roster.topics.length === 0 && roster.unassigned.length === 0;

    return (
      <StudentsPageShell>
        {roster.mode === "demo" ? (
          <DemoModeNotice />
        ) : empty ? (
          <NoStudentsNotice />
        ) : (
          <>
            <ViewSwitch view={view} />
            <InstructorStudentTopicRoster roster={roster} />
          </>
        )}
      </StudentsPageShell>
    );
  }

  const sort = parseSort(
    typeof params.sort === "string" ? params.sort : undefined,
  );
  const search = typeof params.q === "string" ? params.q : undefined;
  const page = parsePage(
    typeof params.page === "string" ? params.page : undefined,
  );
  const list = await listInstructorStudents(authorization, {
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    search,
    sort,
  });
  // Only the students on this page get usernames, and only when there are
  // any: an empty page or the demo store records nothing.
  const identities =
    list.mode === "database" && list.students.length > 0
      ? await resolveInstructorStudentIdentities(
          authorization,
          list.students.map((student) => student.studentKey),
          { requestId },
        )
      : undefined;
  const firstShown = list.offset + 1;
  const lastShown = Math.min(list.offset + list.limit, list.total);

  return (
    <StudentsPageShell>
      {list.mode === "demo" ? (
        <DemoModeNotice />
      ) : list.total === 0 && !search ? (
        <NoStudentsNotice />
      ) : (
        <>
          <ViewSwitch view={view} />
          <form
            action=""
            className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
          >
            <Field label="Search by student code" className="sm:w-72">
              <Input
                autoComplete="off"
                defaultValue={search}
                name="q"
                placeholder="e.g. 8f2a…"
                spellCheck={false}
                type="search"
              />
            </Field>
            <Field label="Sort by" id="student-sort" className="sm:w-60">
              <NativeSelect defaultValue={sort} name="sort">
                <option value="last_active">Last active</option>
                <option value="lowest_accuracy">Lowest overall accuracy</option>
                <option value="attempts">Most attempts</option>
                <option value="sessions">Most sessions</option>
              </NativeSelect>
            </Field>
            <Button
              type="submit"
              variant="secondary"
              className="pointer-coarse:h-11"
            >
              <Search aria-hidden="true" />
              Apply
            </Button>
          </form>

          {list.total === 0 ? (
            <EmptyState
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/professor/students" prefetch={false}>
                    Clear search
                  </Link>
                </Button>
              }
            >
              No students match “{search}”.
            </EmptyState>
          ) : (
            <>
              <InstructorStudentTable
                identities={identities}
                list={list}
                sketchpadMeasurementEnabled={
                  getServerEnv().SKETCHPAD_ACTIVE_TIME_MEASUREMENT_ENABLED
                }
              />

              <nav
                aria-label="Student pages"
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <p className="type-small text-ink-muted">
                  <span className="font-mono tabular text-ink">
                    {firstShown}–{lastShown}
                  </span>{" "}
                  of{" "}
                  <span className="font-mono tabular text-ink">
                    {list.total}
                  </span>{" "}
                  {list.total === 1 ? "student" : "students"}
                </p>
                <div className="flex items-center gap-2">
                  {page > 1 ? (
                    <Button asChild variant="outline" size="sm">
                      <Link
                        href={`/professor/students?page=${page - 1}&sort=${sort}${search ? `&q=${search}` : ""}`}
                        prefetch={false}
                      >
                        Previous
                      </Link>
                    </Button>
                  ) : null}
                  {list.offset + list.limit < list.total ? (
                    <Button asChild variant="outline" size="sm">
                      <Link
                        href={`/professor/students?page=${page + 1}&sort=${sort}${search ? `&q=${search}` : ""}`}
                        prefetch={false}
                      >
                        Next
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </nav>
            </>
          )}
        </>
      )}
    </StudentsPageShell>
  );
}

function StudentsPageShell({ children }: { children: ReactNode }) {
  return (
    <ProfessorPageShell
      title="Students"
      breadcrumbs={[
        { label: "Workspace", href: "/professor" },
        { label: "Students" },
      ]}
      description="Everyone who has signed in to the tutor, with the practice they have recorded."
      notice="Usernames are looked up for this visit only and each display is audited; names and email addresses stay on each student's record."
    >
      {children}
    </ProfessorPageShell>
  );
}

function DemoModeNotice() {
  return (
    <EmptyState>
      Demo mode keeps practice in memory for each visitor, so there is no class
      to list here until you connect the database.
    </EmptyState>
  );
}

function NoStudentsNotice() {
  return (
    <EmptyState>
      No students have signed in or practiced with the tutor yet; each one
      appears here after their first sign-in.
    </EmptyState>
  );
}

const VIEW_LABELS: Record<StudentsView, string> = {
  activity: "Activity",
  topics: "By topic",
};

/**
 * Two link tabs. Links, not Radix tabs: each view is its own audited server
 * render, and neither may be prefetched on hover.
 */
function ViewSwitch({ view }: { view: StudentsView }) {
  return (
    <LinkTabs label="Students view">
      {VIEWS.map((candidate) => (
        <LinkTab
          current={candidate === view}
          href={
            candidate === "activity"
              ? "/professor/students"
              : `/professor/students?view=${candidate}`
          }
          key={candidate}
          // Rendering either view shows usernames and records it, so a
          // hover must not do it on the professor's behalf.
          prefetch={false}
        >
          {VIEW_LABELS[candidate]}
        </LinkTab>
      ))}
    </LinkTabs>
  );
}
