"use client";

import { useState } from "react";

import { ConfirmDialog } from "@/components/courses/confirm-dialog";
import {
  ReleaseStatusChip,
  sectionLabelText,
} from "@/components/courses/course-status";
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

type PendingUpdate = {
  sectionId: string;
  label: string;
  version: number;
  previousVersion: number | null;
};

function SectionRow({
  row,
  onUpdate,
}: {
  row: QuestionReleaseSectionRow;
  onUpdate: (request: PendingUpdate) => void;
}) {
  const target = row.status === "older" ? row.publishedVersion : null;
  const label = sectionLabelText(row.label);
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="type-body text-ink">{label}</span>
        <ReleaseStatusChip status={row.status} />
      </div>
      {target !== null ? (
        <Button
          className="min-h-11 w-fit whitespace-normal text-left"
          onClick={() =>
            onUpdate({
              sectionId: row.sectionId,
              label,
              version: target,
              previousVersion: row.releasedVersion,
            })
          }
          type="button"
          variant="secondary"
        >
          Update {label} to the newest version
        </Button>
      ) : null}
    </li>
  );
}

/**
 * "Which sections see this": the rail beside the question editor. A section
 * keeps the version it was shown, so editing a question does not change what
 * Section 2 sees until the professor updates it — a separate, deliberate act
 * that asks first and can be undone.
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
  const [pending, setPending] = useState<PendingUpdate | null>(null);
  const question = state.bank.find((candidate) => candidate.id === questionId);

  if (!question) {
    return (
      <section
        aria-labelledby="release-rail-title"
        className="flex flex-col gap-2 rounded-panel bg-surface-tint p-5"
      >
        <h2 className="type-h3 text-ink" id="release-rail-title">
          Which sections see this
        </h2>
        <p className="type-body text-ink-muted">
          This question is not part of the courses demo.
        </p>
      </section>
    );
  }

  const groups = questionReleaseMap(state, questionId).filter(
    (group) => group.sections.length > 0,
  );

  function updateToVersion(request: PendingUpdate) {
    dispatch({
      type: "section/moveToVersion",
      sectionId: request.sectionId,
      questionId,
      version: request.version,
    });
    const previous = request.previousVersion;
    toast({
      title: `Students in ${request.label} now see the edited question.`,
      tone: "success",
      action:
        previous !== null
          ? {
              label: "Undo",
              onClick: () =>
                dispatch({
                  type: "section/moveToVersion",
                  sectionId: request.sectionId,
                  questionId,
                  version: previous,
                }),
            }
          : undefined,
      duration: 15_000,
    });
  }

  return (
    <section
      aria-labelledby="release-rail-title"
      className="flex flex-col gap-4 rounded-panel bg-surface-tint p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 className="type-h3 text-ink" id="release-rail-title">
          Which sections see this
        </h2>
        <p className="type-body max-w-prose text-ink-muted">
          When you edit a question, sections keep the version they have until
          you update them.
        </p>
      </div>
      {groups.length === 0 ? (
        <p className="type-body text-ink-muted">No course has a section yet.</p>
      ) : null}
      {groups.map((group) => (
        <div className="flex flex-col gap-1" key={group.course.id}>
          <h3 className="type-body-strong text-ink">
            <span className="font-mono">{group.course.code}</span>{" "}
            {shortTerm(group.course.term)}
          </h3>
          <ul className="divide-y divide-rule">
            {group.sections.map((row) => (
              <SectionRow key={row.sectionId} onUpdate={setPending} row={row} />
            ))}
          </ul>
        </div>
      ))}

      <ConfirmDialog
        cancelLabel="Keep the version they have"
        confirmLabel={
          pending ? `Update ${pending.label}` : "Update to the newest version"
        }
        description={
          pending
            ? `Students in ${pending.label} will see the edited question from now on.`
            : ""
        }
        onConfirm={() => {
          if (pending) {
            updateToVersion(pending);
          }
        }}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null);
          }
        }}
        open={pending !== null}
        title={
          pending
            ? `Update ${pending.label} to the newest version?`
            : "Update to the newest version?"
        }
      />
    </section>
  );
}
