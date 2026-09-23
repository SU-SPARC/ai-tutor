"use client";

import { useMemo, useState } from "react";
import { Download, Search } from "lucide-react";

import { SectionRosterTable } from "@/components/courses/section-roster-table";
import { TopicMasteryBars } from "@/components/courses/topic-mastery-bars";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { SEED_NOW } from "@/lib/courses/demo-seed";
import { formatRelativeTime, shortStudentLabel } from "@/lib/courses/format";
import type { SectionProgress } from "@/lib/courses/selectors";
import type { CourseSection, SectionMember } from "@/lib/courses/types";

const PAGE_SIZE = 25;

type SortKey = "last_active" | "sessions" | "correctness" | "hints";

const SORT_LABELS: Record<SortKey, string> = {
  last_active: "Last active",
  sessions: "Sessions",
  correctness: "Correctness",
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-6">
        <span className="text-2xl leading-none font-semibold tracking-tight">
          {value}
        </span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </CardContent>
    </Card>
  );
}

/**
 * The Progress tab: three numbers a professor can act on, mastery per topic,
 * and the roster the numbers came from — the same data as
 * `/professor/students`, narrowed to the students who joined this section.
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

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = visible.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

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
    <>
      <div className="grid gap-4 md:grid-cols-3">
        <Stat
          label="Class correctness"
          value={`${progress.classCorrectness}%`}
        />
        <Stat
          label="Active this week"
          value={`${progress.activeThisWeek}/${progress.activeTotal}`}
        />
        <Stat label="Needs attention" value={String(progress.needsAttention)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Topic mastery</CardTitle>
          <CardDescription>
            Average mastery across the students who have reached each topic.
            Closed topics are left off — a topic nobody can open is not a topic
            nobody understands.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TopicMasteryBars rows={progress.topicMastery} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Students</CardTitle>
            <CardDescription>
              {members.length} joined · identities are hashed; you see codes,
              not names.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-56 flex-1">
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                aria-label="Filter students by code"
                className="pl-9"
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="code…"
                value={search}
              />
            </div>
            <NativeSelect
              aria-label="Sort students"
              className="w-auto"
              onChange={(event) => {
                setSort(event.target.value as SortKey);
                setPage(1);
              }}
              value={sort}
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <option key={key} value={key}>
                  Sort: {SORT_LABELS[key]}
                </option>
              ))}
            </NativeSelect>
            <Button onClick={handleExport} variant="outline">
              <Download className="h-4 w-4" />
              Export
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SectionRosterTable members={pageRows} />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {visible.length === 0
                ? "No students match."
                : `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${
                    (currentPage - 1) * PAGE_SIZE + pageRows.length
                  } of ${visible.length}`}
              {" · "}
              Last activity{" "}
              {members.length > 0
                ? formatRelativeTime(
                    members.reduce(
                      (latest, member) =>
                        member.lastActiveAt > latest
                          ? member.lastActiveAt
                          : latest,
                      members[0].lastActiveAt,
                    ),
                    SEED_NOW,
                  )
                : "—"}
            </p>
            <div className="flex items-center gap-2">
              <Button
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
                size="sm"
                variant="outline"
              >
                Prev
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {currentPage} of {pageCount}
              </span>
              <Button
                disabled={currentPage >= pageCount}
                onClick={() => setPage(currentPage + 1)}
                size="sm"
                variant="outline"
              >
                Next
              </Button>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Same data as{" "}
            <span className="font-medium">/professor/students</span>, filtered
            to this section&rsquo;s members.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
