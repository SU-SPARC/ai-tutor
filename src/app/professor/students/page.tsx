import type { ReactNode } from "react";
import Link from "next/link";
import { Search, Users } from "lucide-react";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { InstructorStudentTable } from "@/components/professor/instructor-student-table";
import { InstructorStudentTopicRoster } from "@/components/professor/instructor-student-topic-roster";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  requireAnalyticsAccess,
  requirePageAccess,
} from "@/lib/auth/authorization";
import { listInstructorStudents } from "@/lib/data/data-store";
import { pilotRequestId } from "@/lib/observability/pilot-operations";
import {
  resolveInstructorStudentIdentities,
  resolveInstructorStudentRoster,
} from "@/lib/professor/student-identity";
import type { InstructorStudentSort } from "@/lib/types";
import { cn } from "@/lib/utils";

const SORTS: InstructorStudentSort[] = [
  "last_active",
  "lowest_accuracy",
  "attempts",
  "sessions",
];

/**
 * Two readings of the same class: the activity table, sortable and searchable
 * by student code, and the roster grouped by practised topic. Both show the
 * students' names, resolved on the server for the signed-in professor and
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
  // Only the students on this page are named, and only when there are any:
  // an empty page or the demo store records nothing.
  const identities =
    list.mode === "database" && list.students.length > 0
      ? await resolveInstructorStudentIdentities(
          authorization,
          list.students.map((student) => student.studentKey),
          { requestId },
        )
      : undefined;

  return (
    <StudentsPageShell>
      {list.mode === "demo" ? (
        <DemoModeNotice />
      ) : list.total === 0 && !search ? (
        <NoStudentsNotice />
      ) : (
        <>
          <ViewSwitch view={view} />
          <form className="flex flex-wrap items-center gap-3" action="">
            <div className="flex h-10 min-w-60 items-center gap-2 rounded-md border border-input bg-background px-3 shadow-sm">
              <Search
                aria-hidden="true"
                className="h-4 w-4 text-muted-foreground"
              />
              <input
                aria-label="Search by student code"
                className="w-full bg-transparent text-sm outline-none"
                defaultValue={search}
                name="q"
                placeholder="Student code, e.g. 8f2a"
                type="search"
              />
            </div>
            <label className="sr-only" htmlFor="student-sort">
              Sort students
            </label>
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none"
              defaultValue={sort}
              id="student-sort"
              name="sort"
            >
              <option value="last_active">Last active</option>
              <option value="lowest_accuracy">Lowest overall accuracy</option>
              <option value="attempts">Most attempts</option>
              <option value="sessions">Most sessions</option>
            </select>
            <button
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              type="submit"
            >
              Apply
            </button>
          </form>

          <InstructorStudentTable identities={identities} list={list} />

          <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
            <span>
              {list.total === 0
                ? "No students match that code."
                : `Showing ${list.offset + 1}–${Math.min(list.offset + list.limit, list.total)} of ${list.total}`}
            </span>
            <div className="flex items-center gap-3">
              {page > 1 ? (
                <Link
                  className="font-medium text-primary hover:underline"
                  href={`/professor/students?page=${page - 1}&sort=${sort}${search ? `&q=${search}` : ""}`}
                  prefetch={false}
                >
                  Previous
                </Link>
              ) : null}
              {list.offset + list.limit < list.total ? (
                <Link
                  className="font-medium text-primary hover:underline"
                  href={`/professor/students?page=${page + 1}&sort=${sort}${search ? `&q=${search}` : ""}`}
                  prefetch={false}
                >
                  Next
                </Link>
              ) : null}
            </div>
          </div>
        </>
      )}
    </StudentsPageShell>
  );
}

function StudentsPageShell({ children }: { children: ReactNode }) {
  return (
    <ProfessorPageShell
      title="Students"
      description="Students who have signed in to the tutor, with the practice activity they have recorded. Names are read from the account provider for each visit by an authorized instructor and every display is recorded; the practice analytics themselves hold no names, email addresses, or browser identifiers. A student's username and email address are available from their detail page."
      aside={
        <Badge variant="outline" className="h-10 gap-2 px-4">
          <Users className="h-4 w-4" />
          names audited
        </Badge>
      }
    >
      {children}
    </ProfessorPageShell>
  );
}

function DemoModeNotice() {
  return (
    <Alert>
      <AlertDescription>
        Demo mode keeps tutor sessions in memory for the current visitor only,
        so there is no class to list here. Connect the database to see recorded
        practice activity.
      </AlertDescription>
    </Alert>
  );
}

function NoStudentsNotice() {
  return (
    <Alert>
      <AlertDescription>
        No students have signed in or practised with the tutor yet.
      </AlertDescription>
    </Alert>
  );
}

const VIEW_LABELS: Record<StudentsView, string> = {
  activity: "Activity",
  topics: "By topic",
};

function ViewSwitch({ view }: { view: StudentsView }) {
  return (
    <nav
      aria-label="Students view"
      className="flex w-fit items-center gap-1 rounded-md border border-border bg-card p-1 text-sm shadow-xs"
    >
      {VIEWS.map((candidate) => {
        const active = candidate === view;
        return (
          <Link
            key={candidate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-sm px-3 py-1.5 font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
            href={
              candidate === "activity"
                ? "/professor/students"
                : `/professor/students?view=${candidate}`
            }
            // Rendering either view names students and records it, so a
            // hover must not do it on the professor's behalf.
            prefetch={false}
          >
            {VIEW_LABELS[candidate]}
          </Link>
        );
      })}
    </nav>
  );
}
