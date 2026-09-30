import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";

import { ProfessorCourseFilter } from "@/components/professor/professor-course-filter";
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
import { getSelectedCourse } from "@/lib/course-selection";
import { listInstructorStudents } from "@/lib/data/data-store";
import { activeCanonicalSyllabusTopicsForCourse } from "@/lib/data/canonical-syllabus-topics";
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
 * Two readings of the same class: the main table, sortable and searchable
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
  // The class, in the course the professor is working in.
  const { course, courses } = await getSelectedCourse();
  const courseFilter = (
    <ProfessorCourseFilter
      courses={courses}
      returnTo="/professor/students"
      selectedCourseId={course.id}
    />
  );

  if (view === "topics") {
    const roster = await resolveInstructorStudentRoster(authorization, {
      courseId: course.id,
      requestId,
    });
    const empty = roster.topics.length === 0 && roster.unassigned.length === 0;

    return (
      <StudentsPageShell courseFilter={courseFilter}>
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
    courseId: course.id,
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
    <StudentsPageShell courseFilter={courseFilter}>
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
            {/*
             * Usernames are read live from the sign-in provider for the
             * students on the current page only, so the server can match the
             * student code alone; the helper says so rather than promising a
             * username search.
             */}
            <Field
              label="Find a student"
              description="Type the code shown under each username, e.g. 8F2A"
              className="sm:w-80"
            >
              <Input
                autoComplete="off"
                className="min-h-11"
                defaultValue={search}
                name="q"
                spellCheck={false}
                type="search"
              />
            </Field>
            <Field label="Sort by" id="student-sort" className="sm:w-64">
              <NativeSelect className="min-h-11" defaultValue={sort} name="sort">
                <option value="last_active">Most recently active</option>
                <option value="lowest_accuracy">Lowest share correct</option>
                <option value="attempts">Most answers checked</option>
                <option value="sessions">Most study sessions</option>
              </NativeSelect>
            </Field>
            <Button type="submit" variant="secondary" className="min-h-11">
              <Search aria-hidden="true" />
              Show students
            </Button>
          </form>

          {list.total === 0 ? (
            <EmptyState
              action={
                <Button asChild variant="outline" className="min-h-11">
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
                topicCount={activeCanonicalSyllabusTopicsForCourse(course.id).length}
              />

              <nav
                aria-label="Student pages"
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <p className="type-body text-ink">
                  Showing <span className="tabular">{firstShown}</span> to{" "}
                  <span className="tabular">{lastShown}</span> of{" "}
                  <span className="tabular">{list.total}</span>{" "}
                  {list.total === 1 ? "student" : "students"}
                </p>
                <div className="flex items-center gap-2">
                  {page > 1 ? (
                    <Button asChild variant="outline" className="min-h-11">
                      <Link
                        href={`/professor/students?page=${page - 1}&sort=${sort}${search ? `&q=${encodeURIComponent(search)}` : ""}`}
                        prefetch={false}
                      >
                        Previous
                      </Link>
                    </Button>
                  ) : null}
                  {list.offset + list.limit < list.total ? (
                    <Button asChild variant="outline" className="min-h-11">
                      <Link
                        href={`/professor/students?page=${page + 1}&sort=${sort}${search ? `&q=${encodeURIComponent(search)}` : ""}`}
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

function StudentsPageShell({
  children,
  courseFilter,
}: {
  children: ReactNode;
  courseFilter?: ReactNode;
}) {
  return (
    <ProfessorPageShell
      courseFilter={courseFilter}
      title="Students"
      breadcrumbs={[
        { label: "Home", href: "/professor" },
        { label: "Students" },
      ]}
      description={STUDENTS_DESCRIPTION}
      notice={STUDENTS_NOTICE}
    >
      {children}
    </ProfessorPageShell>
  );
}

const STUDENTS_DESCRIPTION =
  "Everyone who has practiced, with what they’ve done so far.";

const STUDENTS_NOTICE =
  "You see usernames here. Open a student to see their full name and email.";

function DemoModeNotice() {
  return <EmptyState>This is a demo, so there’s no real class to show.</EmptyState>;
}

function NoStudentsNotice() {
  return (
    <EmptyState>
      No students have practiced yet. Each student appears here after they
      first sign in.
    </EmptyState>
  );
}

/**
 * The by-topic roster stays a second view rather than a Topic filter on the
 * main table: the table's server query cannot filter by topic, and the roster
 * is its own audited render.
 */
const VIEW_LABELS: Record<StudentsView, string> = {
  activity: "All students",
  topics: "Students by topic",
};

/**
 * Two link tabs. Links, not Radix tabs: each view is its own audited server
 * render, and neither may be prefetched on hover.
 */
function ViewSwitch({ view }: { view: StudentsView }) {
  return (
    <LinkTabs label="How to list students">
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
