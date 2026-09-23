"use client";

import {
  useOptionalCoursesStore,
  type CoursesStoreValue,
} from "@/components/courses/courses-store";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  onMove: (sectionId: string, version: number) => void;
}) {
  if (row.status === "live") {
    return (
      <li className="flex items-center justify-between gap-3 py-1.5">
        <span className="text-sm">{row.label}</span>
        <span className="text-sm text-success">
          v{row.releasedVersion} ● live
        </span>
      </li>
    );
  }

  if (row.status === "older") {
    const target = row.publishedVersion;
    return (
      <li className="flex flex-wrap items-center justify-between gap-2 py-1.5">
        <span className="text-sm">{row.label}</span>
        <span className="flex items-center gap-2">
          <span className="text-sm text-warning">
            v{row.releasedVersion} ◐ older version
          </span>
          {target !== null ? (
            <Button
              onClick={() => onMove(row.sectionId, target)}
              size="sm"
              variant="outline"
            >
              Move to v{target}
            </Button>
          ) : null}
        </span>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm">{row.label}</span>
      <span className="text-sm text-muted-foreground">
        {row.status === "held"
          ? "held — version unpublished"
          : "— not released"}
      </span>
    </li>
  );
}

/**
 * "Where this is released": the rail the question editor was missing. A section
 * is pinned to one published version, so a professor who publishes v4 has not
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
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Not part of the courses demo bank.
        </CardContent>
      </Card>
    );
  }

  const groups = questionReleaseMap(state, questionId).filter(
    (group) => group.sections.length > 0,
  );

  function moveToVersion(sectionId: string, version: number) {
    dispatch({
      type: "section/moveToVersion",
      sectionId,
      questionId,
      version,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Where this is released</CardTitle>
        <CardDescription>
          Sections pin a published version. A newer version is not visible to a
          section until you move it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No course has a section yet.
          </p>
        ) : null}
        {groups.map((group) => (
          <div className="flex flex-col gap-1" key={group.course.id}>
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {group.course.code} {shortTerm(group.course.term)}
            </h3>
            <ul className="divide-y divide-border">
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
      </CardContent>
    </Card>
  );
}
