"use client";

import { useMemo, type ReactNode } from "react";

import { plural } from "@/components/courses/course-status";
import { useCoursesStore } from "@/components/courses/courses-store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusChip } from "@/components/ui/status-chip";
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

function ItemGroup({
  children,
  id,
  title,
}: {
  children: ReactNode;
  id: string;
  title: string;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 className="type-label" id={id}>
        {title}
      </h3>
      <ul className="flex flex-col divide-y divide-rule rounded-panel bg-surface-tint">
        {children}
      </ul>
    </section>
  );
}

/**
 * S7. The repo's publication-preview contract, applied to release: preflight
 * every staged change, mark each one Ready or Blocked, make the professor clear
 * the blocked ones by hand, then commit everything in one dispatch.
 *
 * `sectionId` is the *target* — for "Copy to" that is a different section
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
  const blockedCount = preview.blocked.length;
  const canApply = blockedCount === 0 && preview.ready.length > 0;

  const unchangedLine =
    otherSectionLabels.length === 0
      ? null
      : otherSectionLabels.length === 1
        ? `${otherSectionLabels[0]} is unchanged.`
        : `${otherSectionLabels.slice(0, -1).join(", ")} and ${
            otherSectionLabels[otherSectionLabels.length - 1]
          } are unchanged.`;

  const apply = () => {
    if (!canApply) {
      return;
    }
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
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
      open={open}
    >
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            Review {plural(total, "change")} for {sectionLabel}
          </DialogTitle>
          <DialogDescription>
            Adding {plural(stagedAdds, "question")} · removing {stagedRemoves}.
            Nothing changes until you apply.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-6">
          {total === 0 ? (
            <p className="type-body text-ink-muted">
              Nothing to review. The two sections already match.
            </p>
          ) : null}

          {blockedCount > 0 ? (
            <ItemGroup id="review-blocked" title={`Blocked (${blockedCount})`}>
              {preview.blocked.map((entry) => (
                <li
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2"
                  key={`blocked-${entry.question.id}`}
                >
                  <StatusChip label="Blocked" tone="wrong" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="type-small text-ink">
                      {entry.question.title}
                    </span>
                    <span className="type-caption">{entry.reason}</span>
                  </div>
                  <Button
                    onClick={() => onRemoveFromSet(entry.question.id)}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    Remove from set
                  </Button>
                </li>
              ))}
            </ItemGroup>
          ) : null}

          {readyAdds.length > 0 ? (
            <ItemGroup
              id="review-adds"
              title={`To release (${readyAdds.length})`}
            >
              {readyAdds.map((entry) => (
                <li
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
                  key={`add-${entry.question.id}`}
                >
                  <StatusChip label="Ready" tone="approved" />
                  <span className="type-small min-w-0 flex-1 text-ink">
                    {entry.question.title}
                  </span>
                  <span className="type-caption tabular">
                    v{entry.version ?? "—"} · published
                  </span>
                </li>
              ))}
            </ItemGroup>
          ) : null}

          {readyRemoves.length > 0 ? (
            <ItemGroup
              id="review-removes"
              title={`To remove (${readyRemoves.length})`}
            >
              {readyRemoves.map((entry) => {
                const pinned = pinnedByQuestion.get(entry.question.id) ?? 0;
                return (
                  <li
                    className="flex flex-col gap-1 px-3 py-2"
                    key={`remove-${entry.question.id}`}
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <StatusChip label="Ready" tone="approved" />
                      <span className="type-small min-w-0 flex-1 text-ink">
                        {entry.question.title}
                      </span>
                      {pinned > 0 ? (
                        <StatusChip
                          label={`Retired for ${plural(pinned, "student")}`}
                          tone="retired"
                        />
                      ) : null}
                    </div>
                    {pinned > 0 ? (
                      <p className="type-caption">
                        {plural(pinned, "student has", "students have")} an
                        open session on this version and will see it as
                        retired.
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ItemGroup>
          ) : null}
        </DialogBody>

        <DialogFooter className="sm:justify-between">
          <div className="flex flex-col gap-0.5">
            <p className="type-small text-ink">
              Applies only to {sectionLabel}.
              {unchangedLine ? ` ${unchangedLine}` : ""}
            </p>
            {blockedCount > 0 ? (
              <p className="type-caption">
                Remove the {plural(blockedCount, "blocked question")} to apply.
              </p>
            ) : null}
          </div>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button disabled={!canApply} onClick={apply} type="button">
              Apply {plural(preview.ready.length, "change")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
