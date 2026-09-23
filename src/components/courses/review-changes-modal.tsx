"use client";

import { useMemo } from "react";

import { useCoursesStore } from "@/components/courses/courses-store";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { SEED_NOW } from "@/lib/courses/demo-seed";
import { previewReleaseChanges } from "@/lib/courses/selectors";
import type {
  QuestionId,
  SectionId,
  StagedReleaseChange,
} from "@/lib/courses/types";

export type AppliedSummary = {
  added: number;
  removed: number;
  sectionId: SectionId;
  sectionLabel: string;
};

function plural(count: number, one: string, many: string) {
  return count === 1 ? one : many;
}

/**
 * S7. The repo's publication-preview contract, applied to release: preflight
 * every staged change, show ready / warned / blocked per item, make the
 * professor clear the blocked ones by hand, then commit in one dispatch.
 *
 * `sectionId` is the *target* — for "Copy to ▾" that is a different section
 * from the one on screen, which is why the footer names it explicitly.
 */
export function ReviewChangesModal({
  changes,
  onApplied,
  onClose,
  onRemoveFromSet,
  open,
  otherSectionLabels,
  sectionId,
  sectionLabel,
}: {
  changes: StagedReleaseChange[];
  onApplied: (summary: AppliedSummary) => void;
  onClose: () => void;
  onRemoveFromSet: (questionId: QuestionId) => void;
  open: boolean;
  /** Every other section of this course, for the "unchanged" reassurance. */
  otherSectionLabels: string[];
  sectionId: SectionId;
  sectionLabel: string;
}) {
  const { state, dispatch } = useCoursesStore();

  const preview = useMemo(
    () => previewReleaseChanges(state, sectionId, changes),
    [state, sectionId, changes],
  );

  const pinnedByQuestion = useMemo(
    () =>
      new Map(
        preview.warnings.map((warning) => [
          warning.question.id,
          warning.pinnedSessions,
        ]),
      ),
    [preview],
  );

  const readyAdds = preview.ready.filter((entry) => entry.kind === "add");
  const readyRemoves = preview.ready.filter((entry) => entry.kind === "remove");
  const blockedAdds = preview.blocked.filter((entry) => entry.kind === "add");
  const total = preview.ready.length + preview.blocked.length;
  const stagedAdds = readyAdds.length + blockedAdds.length;
  const stagedRemoves =
    readyRemoves.length + (preview.blocked.length - blockedAdds.length);

  const unchangedLine =
    otherSectionLabels.length === 0
      ? null
      : otherSectionLabels.length === 1
        ? `${otherSectionLabels[0]} is unchanged.`
        : `${otherSectionLabels.slice(0, -1).join(", ")} and ${
            otherSectionLabels[otherSectionLabels.length - 1]
          } are unchanged.`;

  const apply = () => {
    dispatch({
      type: "section/applyReleaseChanges",
      sectionId,
      changes,
      now: SEED_NOW,
    });
    onApplied({
      added: readyAdds.length,
      removed: readyRemoves.length,
      sectionId,
      sectionLabel,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`Review ${total} ${plural(total, "change", "changes")} for ${sectionLabel}`}
      description={`Adding ${stagedAdds} ${plural(
        stagedAdds,
        "question",
        "questions",
      )} · Removing ${stagedRemoves}`}
      footer={
        <>
          <p className="text-xs text-muted-foreground">
            Applies only to {sectionLabel}.{" "}
            {unchangedLine ? unchangedLine : null}
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={apply}
              disabled={
                preview.blocked.length > 0 || preview.ready.length === 0
              }
              title={
                preview.blocked.length > 0
                  ? "Remove the blocked questions from the set first."
                  : undefined
              }
            >
              Apply {preview.ready.length}{" "}
              {plural(preview.ready.length, "change", "changes")}
            </Button>
          </div>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing to review. The two sections already match.
          </p>
        ) : null}

        {readyAdds.length > 0 ? (
          <section aria-label="Questions to release">
            <ul className="flex flex-col gap-1.5">
              {readyAdds.map((entry) => (
                <li
                  key={`add-${entry.question.id}`}
                  className="flex flex-wrap items-baseline gap-x-2 text-sm"
                >
                  <span className="text-success" aria-hidden="true">
                    ✔
                  </span>
                  <span className="min-w-0 flex-1">{entry.question.title}</span>
                  <span className="text-xs text-muted-foreground">
                    v{entry.version ?? "—"} · published
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {readyRemoves.length > 0 ? (
          <section aria-label="Questions to remove">
            <ul className="flex flex-col gap-2">
              {readyRemoves.map((entry) => {
                const pinned = pinnedByQuestion.get(entry.question.id) ?? 0;
                return (
                  <li key={`remove-${entry.question.id}`} className="text-sm">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span
                        className="text-muted-foreground"
                        aria-hidden="true"
                      >
                        ⊖
                      </span>
                      <span className="min-w-0 flex-1">
                        {entry.question.title}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        removing
                      </span>
                    </div>
                    {pinned > 0 ? (
                      <p className="mt-1 pl-5 text-xs leading-5 text-warning">
                        ⚠ Removing “{entry.question.title}” — {pinned}{" "}
                        {plural(pinned, "student has", "students have")} an open
                        session on this version. They will see it as retired.
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {preview.blocked.length > 0 ? (
          <section aria-label="Blocked questions">
            <ul className="flex flex-col gap-1.5">
              {preview.blocked.map((entry) => (
                <li
                  key={`blocked-${entry.question.id}`}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
                >
                  <span className="text-destructive" aria-hidden="true">
                    ✖
                  </span>
                  <span className="min-w-0 flex-1">
                    {entry.question.title}
                    <span className="text-muted-foreground">
                      {" "}
                      — blocked: {entry.reason}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onRemoveFromSet(entry.question.id)}
                  >
                    Remove from set
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}
