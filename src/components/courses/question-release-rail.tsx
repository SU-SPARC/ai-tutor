"use client";

import { ReleaseStatusChip } from "@/components/courses/course-status";
import {
  useOptionalCoursesStore,
  type CoursesStoreValue,
} from "@/components/courses/courses-store";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { questionReleaseMap } from "@/lib/courses/selectors";
import type { QuestionReleaseSectionRow } from "@/lib/courses/selectors";

/**
 * Local helper: the seed terms read "Fall 2026" but the rail is a narrow
 * column, so the year is abbreviated the way the blueprint writes it
 * ("MATH-255 Fall 26"). No shared formatter does this.
 */
function shortTerm(term: string) {
  return term.replace(/\b(\d{2})(\d{2})\b/, "$2");
}

function SectionRow({
  row,
  onMove,
}: {
  row: QuestionReleaseSectionRow;
  onMove: (sectionId: string, label: string, version: number) => void;
}) {
  const target = row.status === "older" ? row.publishedVersion : null;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2">
      <span className="type-small text-ink">{row.label}</span>
      <span className="flex flex-wrap items-center gap-2">
        <ReleaseStatusChip
          releasedVersion={row.releasedVersion}
          status={row.status}
        />
        {target !== null ? (
          <Button
            onClick={() => onMove(row.sectionId, row.label, target)}
            size="sm"
            type="button"
            variant="secondary"
          >
            Move to v{target}
          </Button>
        ) : null}
      </span>
    </li>
  );
}

/**
 * "Where this is released": the rail beside the question editor. A section is
 * pinned to one published version, so a professor who publishes v4 has not
 * yet changed what Sec 02 sees — moving it is a separate, deliberate act.
 */
export function QuestionReleaseRail({ questionId }: { questionId: string }) {
  const store = useOptionalCoursesStore();
  // The question editor is also rendered outside the /professor layout (its
  // page is exercised directly in tests), so a missing provider degrades to
  // nothing rather than throwing.
  if (!store) {
    return null;
  }
  return <ReleaseRail questionId={questionId} store={store} />;
}

function ReleaseRail({
  questionId,
  store,
}: {
  questionId: string;
  store: CoursesStoreValue;
}) {
  const { state, dispatch } = store;
  const question = state.bank.find((candidate) => candidate.id === questionId);

  if (!question) {
    return (
      <section
        aria-labelledby="release-rail-title"
        className="flex flex-col gap-2 rounded-panel bg-surface-tint p-5"
      >
        <h2 className="type-h3 text-ink" id="release-rail-title">
          Where this is released
        </h2>
        <p className="type-small text-ink-muted">
          Not part of the courses demo bank.
        </p>
      </section>
    );
  }

  const groups = questionReleaseMap(state, questionId).filter(
    (group) => group.sections.length > 0,
  );

  function moveToVersion(sectionId: string, label: string, version: number) {
    dispatch({
      type: "section/moveToVersion",
      sectionId,
      questionId,
      version,
    });
    toast({
      title: `${label} now sees v${version}`,
      tone: "success",
    });
  }

  return (
    <section
      aria-labelledby="release-rail-title"
      className="flex flex-col gap-4 rounded-panel bg-surface-tint p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 className="type-h3 text-ink" id="release-rail-title">
          Where this is released
        </h2>
        <p className="type-small max-w-prose text-ink-muted">
          Each section pins one published version. A newer version reaches a
          section only when you move it.
        </p>
      </div>
      {groups.length === 0 ? (
        <p className="type-small text-ink-muted">No course has a section yet.</p>
      ) : null}
      {groups.map((group) => (
        <div className="flex flex-col gap-1" key={group.course.id}>
          <h3 className="type-label">
            <span className="font-mono">{group.course.code}</span>{" "}
            {shortTerm(group.course.term)}
          </h3>
          <ul className="divide-y divide-rule">
            {group.sections.map((row) => (
              <SectionRow
                key={row.sectionId}
                onMove={moveToVersion}
                row={row}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
