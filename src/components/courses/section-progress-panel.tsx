"use client";

import { useMemo, useState } from "react";
import { Download, Search } from "lucide-react";

import { plural } from "@/components/courses/course-status";
import {
  SectionRosterTable,
  type RosterSortKey,
} from "@/components/courses/section-roster-table";
import { TopicMasteryBars } from "@/components/courses/topic-mastery-bars";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MetricTile } from "@/components/ui/metric-tile";
import { NativeSelect } from "@/components/ui/native-select";
import { SEED_NOW } from "@/lib/courses/demo-seed";
import { formatRelativeTime, shortStudentLabel } from "@/lib/courses/format";
import type { SectionProgress } from "@/lib/courses/selectors";
import type { CourseSection, SectionMember } from "@/lib/courses/types";

const PAGE_SIZE = 25;

type SortKey = RosterSortKey;

const SORT_LABELS: Record<SortKey, string> = {
  last_active: "Last active",
  sessions: "Sessions",
  correctness: "Correct",
  hints: "Hints",
};

function correctness(member: SectionMember) {
  return member.attempts > 0 ? member.correctAttempts / member.attempts : -1;
}

function compare(left: SectionMember, right: SectionMember, sort: SortKey) {
  switch (sort) {
    case "sessions":
      return right.sessions - left.sessions;
    case "correctness":
      return correctness(right) - correctness(left);
    case "hints":
      return right.hintsUsed - left.hintsUsed;
    default:
      return right.lastActiveAt.localeCompare(left.lastActiveAt);
  }
}

/** RFC-4180 enough for a spreadsheet: quote everything, double inner quotes. */
function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function buildCsv(members: SectionMember[]) {
  const header = [
    "student_label",
    "student_key",
    "sessions",
    "attempts",
    "correct_attempts",
    "correctness_pct",
    "hints_used",
    "attention_note",
    "last_active_at",
  ];
  const rows = members.map((member) =>
    [
      shortStudentLabel(member.studentKey),
      member.studentKey,
      member.sessions,
      member.attempts,
      member.correctAttempts,
      member.attempts > 0
        ? Math.round((member.correctAttempts / member.attempts) * 100)
        : "",
      member.hintsUsed,
      member.attentionNote ?? "",
      member.lastActiveAt,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.map(csvCell).join(","), ...rows].join("\n");
}

/**
 * The Progress tab: three numbers a professor can act on, mastery per open
 * topic, and the roster the numbers came from (this section's members only).
 */
export function SectionProgressPanel({
  members,
  progress,
  section,
}: {
  members: SectionMember[];
  progress: SectionProgress;
  section: CourseSection;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("last_active");
  const [page, setPage] = useState(1);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = needle
      ? members.filter((member) =>
          member.studentKey.toLowerCase().startsWith(needle),
        )
      : members;
    return [...filtered].sort((left, right) => compare(left, right, sort));
  }, [members, search, sort]);

  const totals = useMemo(
    () =>
      members.reduce(
        (sum, member) => ({
          attempts: sum.attempts + member.attempts,
          correct: sum.correct + member.correctAttempts,
        }),
        { attempts: 0, correct: 0 },
      ),
    [members],
  );

  const lastActivity = members.reduce<string | null>(
    (latest, member) =>
      latest === null || member.lastActiveAt > latest
        ? member.lastActiveAt
        : latest,
    null,
  );

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = visible.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const firstShown = (currentPage - 1) * PAGE_SIZE + 1;
  const lastShown = (currentPage - 1) * PAGE_SIZE + pageRows.length;

  function handleExport() {
    const blob = new Blob([buildCsv(visible)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${section.id}-students.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-10">
      <section aria-label="Section summary" className="grid gap-3 sm:grid-cols-3">
        <MetricTile
          delta={
            totals.attempts > 0
              ? `${totals.correct} of ${totals.attempts} answers correct`
              : "No answers yet"
          }
          label="Class correctness"
          value={totals.attempts > 0 ? `${progress.classCorrectness}%` : "—"}
        />
        <MetricTile
          delta={`of ${plural(progress.activeTotal, "student")} joined`}
          label="Active in the last 7 days"
          value={progress.activeThisWeek}
        />
        <MetricTile
          delta="Flagged for repeated misses"
          label="Need attention"
          value={progress.needsAttention}
        />
      </section>

      <section aria-labelledby="section-mastery" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="type-h2 text-ink" id="section-mastery">
            Topic mastery
          </h2>
          <p className="type-small max-w-prose text-ink-muted">
            Average mastery of the students who reached each open topic. Closed
            topics are left off.
          </p>
        </div>
        <TopicMasteryBars rows={progress.topicMastery} />
      </section>

      <section aria-labelledby="section-students" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="type-h2 text-ink" id="section-students">
              Students{" "}
              <span className="type-mono align-middle text-ink-muted">
                {members.length}
              </span>
            </h2>
            <p className="type-small text-ink-muted">
              Last activity{" "}
              {lastActivity ? formatRelativeTime(lastActivity, SEED_NOW) : "—"}
            </p>
          </div>
          <Button
            disabled={visible.length === 0}
            onClick={handleExport}
            type="button"
            variant="secondary"
          >
            <Download aria-hidden="true" />
            Export CSV
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-56 flex-1 sm:max-w-sm">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
            />
            <Input
              aria-label="Filter students by code"
              autoComplete="off"
              className="pl-9"
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search by code…"
              spellCheck={false}
              type="search"
              value={search}
            />
          </div>
          <Field className="flex-row items-center gap-2" label="Sort by">
            <NativeSelect
              className="w-auto"
              onChange={(event) => {
                setSort(event.target.value as SortKey);
                setPage(1);
              }}
              value={sort}
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <option key={key} value={key}>
                  {SORT_LABELS[key]}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>

        <SectionRosterTable
          emptyMessage={
            members.length === 0
              ? `No students have joined yet. Share the join code ${section.joinCode}.`
              : `No student code starts with “${search.trim()}”.`
          }
          members={pageRows}
          sectionLabel={section.label}
          sort={sort}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="type-small tabular text-ink-muted" role="status">
            {visible.length === 0
              ? "No students shown"
              : `Showing ${firstShown}–${lastShown} of ${visible.length}`}
          </p>
          {pageCount > 1 ? (
            <div className="flex items-center gap-2">
              <Button
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
                size="sm"
                type="button"
                variant="secondary"
              >
                Previous
              </Button>
              <span className="type-small tabular text-ink-muted">
                Page {currentPage} of {pageCount}
              </span>
              <Button
                disabled={currentPage >= pageCount}
                onClick={() => setPage(currentPage + 1)}
                size="sm"
                type="button"
                variant="secondary"
              >
                Next
              </Button>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
