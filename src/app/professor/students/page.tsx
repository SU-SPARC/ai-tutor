import Link from "next/link";
import { Search, Users } from "lucide-react";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { InstructorStudentTable } from "@/components/professor/instructor-student-table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  requireAnalyticsAccess,
  requirePageAccess,
} from "@/lib/auth/authorization";
import { listInstructorStudents } from "@/lib/data/data-store";
import type { InstructorStudentSort } from "@/lib/types";

const SORTS: InstructorStudentSort[] = [
  "last_active",
  "lowest_accuracy",
  "attempts",
  "sessions",
];

const PAGE_SIZE = 25;

function parseSort(value: string | undefined): InstructorStudentSort {
  return SORTS.find((sort) => sort === value) ?? "last_active";
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

  return (
    <ProfessorPageShell
      title="Students"
      description="Everyone who has practised with the tutor, identified by a stable pseudonym. Names, email addresses, and browser identifiers are never loaded onto this page."
      aside={
        <Badge variant="outline" className="h-10 gap-2 px-4">
          <Users className="h-4 w-4" />
          pseudonymous
        </Badge>
      }
    >
      {list.mode === "demo" ? (
        <Alert>
          <AlertDescription>
            Demo mode keeps tutor sessions in memory for the current visitor
            only, so there is no class to list here. Connect the database to see
            recorded practice activity.
          </AlertDescription>
        </Alert>
      ) : list.total === 0 && !search ? (
        <Alert>
          <AlertDescription>
            No student practice activity has been recorded yet.
          </AlertDescription>
        </Alert>
      ) : (
        <>
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
              <option value="lowest_accuracy">Repeated difficulty first</option>
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

          <InstructorStudentTable list={list} />

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
                >
                  Previous
                </Link>
              ) : null}
              {list.offset + list.limit < list.total ? (
                <Link
                  className="font-medium text-primary hover:underline"
                  href={`/professor/students?page=${page + 1}&sort=${sort}${search ? `&q=${search}` : ""}`}
                >
                  Next
                </Link>
              ) : null}
            </div>
          </div>
        </>
      )}
    </ProfessorPageShell>
  );
}
