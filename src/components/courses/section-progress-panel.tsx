"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";

import { plural, sectionLabelText } from "@/components/courses/course-status";
import { useCoursesStore } from "@/components/courses/courses-store";
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
import {
  courseTopicsOrdered,
  type SectionProgress,
} from "@/lib/courses/selectors";
import type { CourseSection, SectionMember } from "@/lib/courses/types";

const PAGE_SIZE = 25;

type SortKey = RosterSortKey;

const SORT_LABELS: Record<SortKey, string> = {
  last_active: "Last active",
  sessions: "Sessions",
  correctness: "Correct answers",
  hints: "Hints used",
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

/** Plain column names a professor can read; no names, emails or full keys. */
function buildCsv(members: SectionMember[]) {
  const header = [
    "Student code",
    "Sessions",
    "Answers",
    "Correct",
    "Correct %",
    "Hints used",
    "Note",
    "Last active",
  ];
  const rows = members.map((member) =>
    [
      shortStudentLabel(member.studentKey),
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
 * The Progress tab. First the question a professor actually asks ("has the
 * class done this week?"), then three numbers, the level per open week in
 * named mastery levels, and the roster the numbers came from.
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
  const { state } = useCoursesStore();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("last_active");
  const [page, setPage] = useState(1);
  const sectionText = sectionLabelText(section);

  /** Weeks students in this section can see now, latest first. */
  const openWeeks = useMemo(() => {
    const open = new Set(
      state.topicAvailability
        .filter((row) => row.sectionId === section.id && row.state === "open")
        .map((row) => row.topicId),
    );
    return courseTopicsOrdered(state, section.courseId)
      .filter((entry) => entry.overlay.included && open.has(entry.topic.id))
      .map((entry) => {
        const questionIds = new Set(
          state.bank
            .filter((question) => question.topicId === entry.topic.id)
            .map((question) => question.id),
        );
        const shown = state.questionAvailability.filter(
          (row) =>
            row.sectionId === section.id &&
            row.state === "released" &&
            questionIds.has(row.questionId),
        ).length;
        const tried = members.filter(
          (member) => typeof member.topicMastery[entry.topic.id] === "number",
        ).length;
        return {
          topicId: entry.topic.id,
          weekNumber: entry.topic.weekNumber,
          label: entry.label,
          shown,
          tried,
        };
      })
      .sort((left, right) => right.weekNumber - left.weekNumber);
  }, [state, section.id, section.courseId, members]);

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

  const thisWeek = openWeeks[0];

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="section-this-week" className="flex flex-col gap-3">
        <h2 className="type-h2 text-ink" id="section-this-week">
          {thisWeek ? `This week (Week ${thisWeek.weekNumber})` : "This week"}
        </h2>
        {thisWeek ? (
          <>
            <p className="type-body max-w-prose rounded-panel bg-sheet p-5 text-ink">
              {thisWeek.tried} of {plural(members.length, "student")} have tried
              a Week {thisWeek.weekNumber} question.{" "}
              {plural(thisWeek.shown, "question is", "questions are")} shown to{" "}
              {sectionText} this week.
            </p>
            {openWeeks.length > 1 ? (
              <ul className="flex flex-col divide-y divide-rule rounded-panel bg-sheet px-5">
                {openWeeks.slice(1).map((week) => (
                  <li className="type-body py-3 text-ink" key={week.topicId}>
                    Week {week.weekNumber}: {week.tried} of {members.length}{" "}
                    students have tried a question ({plural(week.shown, "question")}{" "}
                    shown).
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="type-body max-w-prose text-ink-muted">
            Students in {sectionText} cannot see any week yet. Open a week on
            the Choose questions page.
          </p>
        )}
      </section>

      <section aria-label="Section summary" className="grid gap-3 sm:grid-cols-3">
        <MetricTile
          delta={
            totals.attempts > 0
              ? `${totals.correct} of ${totals.attempts} answers were correct`
              : "No answers yet"
          }
          label="Answers correct"
          value={totals.attempts > 0 ? `${progress.classCorrectness}%` : "—"}
        />
        <MetricTile
          delta={`of ${plural(progress.activeTotal, "student")} practiced in the last 7 days`}
          label="Practiced this week"
          value={progress.activeThisWeek}
        />
        <MetricTile
          delta="students missed the same kind of question several times"
          label="May need help"
          value={progress.needsAttention}
        />
      </section>

      <section aria-labelledby="section-mastery" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="type-h2 text-ink" id="section-mastery">
            How well the class knows each week
          </h2>
          <p className="type-body max-w-prose text-ink-muted">
            Only weeks students can see are listed.
          </p>
        </div>
        <TopicMasteryBars
          members={members}
          rows={progress.topicMastery.map((row) => ({
            topicId: row.topicId,
            label: row.label,
          }))}
        />
      </section>

      <section aria-labelledby="section-students" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="type-h2 text-ink" id="section-students">
              Students ({members.length})
            </h2>
            <p className="type-body max-w-prose text-ink-muted">
              Students appear as private codes, not names, to protect their
              privacy. Last activity{" "}
              {lastActivity ? formatRelativeTime(lastActivity, SEED_NOW) : "—"}.
            </p>
          </div>
          <Button
            className="min-h-11"
            disabled={visible.length === 0}
            onClick={handleExport}
            type="button"
            variant="secondary"
          >
            <Download aria-hidden="true" />
            Download spreadsheet (no student names)
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Field
            className="min-w-56 flex-1 sm:max-w-sm"
            description="Type the start of a private code, e.g. A3F9"
            label="Find a student"
          >
            <Input
              autoComplete="off"
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              spellCheck={false}
              type="search"
              value={search}
            />
          </Field>
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
              ? `No students have joined yet. Read the join code ${section.joinCode} to your class.`
              : `No private code starts with “${search.trim()}”.`
          }
          members={pageRows}
          sectionLabel={sectionText}
          sort={sort}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="type-body tabular text-ink-muted" role="status">
            {visible.length === 0
              ? "No students shown"
              : `Showing ${firstShown}–${lastShown} of ${visible.length} students`}
          </p>
          {pageCount > 1 ? (
            <div className="flex items-center gap-2">
              <Button
                className="min-h-11"
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
                type="button"
                variant="secondary"
              >
                Previous
              </Button>
              <span className="type-body tabular text-ink-muted">
                Page {currentPage} of {pageCount}
              </span>
              <Button
                className="min-h-11"
                disabled={currentPage >= pageCount}
                onClick={() => setPage(currentPage + 1)}
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
