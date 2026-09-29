"use client";

import { useMemo, useState, type ReactNode } from "react";

import {
  formatShortDate,
  plural,
  sectionLabelText,
} from "@/components/courses/course-status";
import { useCoursesStore } from "@/components/courses/courses-store";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
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
import { SEED_NOW } from "@/lib/courses/demo-seed";
import { previewReleaseChanges } from "@/lib/courses/selectors";
import type {
  DeliverySettings,
  QuestionId,
  SectionId,
  StagedReleaseChange,
  TopicAvailabilityState,
  TopicId,
} from "@/lib/courses/types";

/** A week that the saved questions belong to, and what students can see of it. */
export type AppliedWeek = {
  topicId: TopicId;
  weekNumber: number;
  /** Questions added to this week in this save. */
  addedCount: number;
  /** The week's state after the save (open when the professor ticked it). */
  state: TopicAvailabilityState;
  opensAt: string | null;
  /** What it was before, so Undo can put it back. */
  previousState: TopicAvailabilityState;
  previousOpensAt: string | null;
  openedNow: boolean;
};

export type AppliedSummary = {
  added: number;
  removed: number;
  sectionId: SectionId;
  sectionLabel: string;
  /** Exactly what was saved, so Undo can dispatch the opposite. */
  applied: StagedReleaseChange[];
  /** Delivery settings of the hidden questions, restored on Undo. */
  previousDelivery: Record<QuestionId, DeliverySettings>;
  weeks: AppliedWeek[];
  /** Changes that could not be saved and were left out. */
  skipped: number;
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
      <h3 className="type-body-strong text-ink" id={id}>
        {title}
      </h3>
      <ul className="flex flex-col divide-y divide-rule rounded-panel bg-surface-tint">
        {children}
      </ul>
    </section>
  );
}

function joinLabels(labels: string[]) {
  if (labels.length <= 1) {
    return labels[0] ?? "";
  }
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** "Show 2 and hide 1 for Section 1" / "Show 2 to Section 1" / "Hide 1 from Section 1". */
export function applyButtonLabel(adds: number, removes: number, section: string) {
  if (adds > 0 && removes > 0) {
    return `Show ${adds} and hide ${removes} for ${section}`;
  }
  if (adds > 0) {
    return `Show ${adds} to ${section}`;
  }
  if (removes > 0) {
    return `Hide ${removes} from ${section}`;
  }
  return `Nothing to change for ${section}`;
}

/**
 * The check before students see anything. Every waiting change is sorted into
 * what will be shown, what will be hidden and what cannot be shown yet (not
 * approved or not ready to use). Those are left out automatically and the
 * dialog says so. Weeks students cannot see yet are listed with a ticked box
 * to open them in the same step, so "saved" and "students can see it" agree.
 *
 * `sectionId` is the *target*: for "Make another section match this one" that
 * is a different section from the one on screen, which is why the footer
 * names it.
 */
export function ReviewChangesModal({
  changes,
  onApplied,
  onClose,
  open,
  otherSectionLabels,
  sectionId,
  sectionLabel,
  sourceSectionLabel,
}: {
  changes: StagedReleaseChange[];
  onApplied: (summary: AppliedSummary) => void;
  onClose: () => void;
  open: boolean;
  /** Every other section of this course, for the "unchanged" reassurance. */
  otherSectionLabels: string[];
  sectionId: SectionId;
  sectionLabel: string;
  /** Set when this is "Make another section match this one". */
  sourceSectionLabel?: string;
}) {
  const { state, dispatch } = useCoursesStore();
  // Ticks the professor changed; anything absent uses the default.
  const [openChoice, setOpenChoice] = useState<Record<TopicId, boolean>>({});
  const section = sectionLabelText(sectionLabel);

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

  const readyAdds = useMemo(
    () => preview.ready.filter((entry) => entry.kind === "add"),
    [preview],
  );
  const readyRemoves = preview.ready.filter((entry) => entry.kind === "remove");
  const blocked = preview.blocked;
  const total = preview.ready.length + blocked.length;
  const canApply = preview.ready.length > 0;
  const allBlockedUnapproved = blocked.every(
    (entry) =>
      entry.kind === "add" &&
      (entry.question.state === "draft" ||
        entry.question.state === "needs_review"),
  );

  /** Weeks that get new questions, with whether students can see them. */
  const weeks = useMemo(() => {
    const byTopic = new Map<TopicId, number>();
    for (const entry of readyAdds) {
      byTopic.set(
        entry.question.topicId,
        (byTopic.get(entry.question.topicId) ?? 0) + 1,
      );
    }
    return [...byTopic.entries()]
      .map(([topicId, addedCount]) => {
        const topic = state.topics.find((candidate) => candidate.id === topicId);
        const row = state.topicAvailability.find(
          (candidate) =>
            candidate.sectionId === sectionId && candidate.topicId === topicId,
        );
        const weekState: TopicAvailabilityState = row?.state ?? "closed";
        return {
          topicId,
          addedCount,
          weekNumber: topic?.weekNumber ?? 0,
          state: weekState,
          opensAt: row?.opensAt ?? null,
        };
      })
      .sort((left, right) => left.weekNumber - right.weekNumber);
  }, [readyAdds, state.topics, state.topicAvailability, sectionId]);

  const hiddenWeeks = weeks.filter((week) => week.state !== "open");
  // Closed weeks are ticked by default: the professor chose these questions
  // so students would see them. A week with a date already chosen is not.
  const willOpen = (week: (typeof weeks)[number]) =>
    openChoice[week.topicId] ?? week.state === "closed";

  const unchangedLine =
    otherSectionLabels.length === 0
      ? null
      : `${joinLabels(otherSectionLabels.map((label) => sectionLabelText(label)))} ${
          otherSectionLabels.length === 1 ? "is" : "are"
        } unchanged.`;

  const close = () => {
    setOpenChoice({});
    onClose();
  };

  const apply = () => {
    if (!canApply) {
      return;
    }
    const applied: StagedReleaseChange[] = preview.ready.map((entry) =>
      entry.kind === "add"
        ? { kind: "add", questionId: entry.question.id }
        : { kind: "remove", questionId: entry.question.id },
    );
    const previousDelivery: Record<QuestionId, DeliverySettings> = {};
    for (const entry of readyRemoves) {
      const row = state.questionAvailability.find(
        (candidate) =>
          candidate.sectionId === sectionId &&
          candidate.questionId === entry.question.id,
      );
      if (row) {
        previousDelivery[entry.question.id] = { ...row.delivery };
      }
    }
    dispatch({
      type: "section/applyReleaseChanges",
      sectionId,
      changes: applied,
      now: SEED_NOW,
    });
    const appliedWeeks: AppliedWeek[] = weeks.map((week) => {
      const openedNow = week.state !== "open" && willOpen(week);
      if (openedNow) {
        dispatch({
          type: "section/setTopicState",
          sectionId,
          topicId: week.topicId,
          state: "open",
          opensAt: null,
        });
      }
      return {
        topicId: week.topicId,
        weekNumber: week.weekNumber,
        addedCount: week.addedCount,
        state: openedNow ? "open" : week.state,
        opensAt: openedNow ? null : week.opensAt,
        previousState: week.state,
        previousOpensAt: week.opensAt,
        openedNow,
      };
    });
    setOpenChoice({});
    onApplied({
      added: readyAdds.length,
      removed: readyRemoves.length,
      sectionId,
      sectionLabel,
      applied,
      previousDelivery,
      weeks: appliedWeeks,
      skipped: blocked.length,
    });
  };

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          close();
        }
      }}
      open={open}
    >
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Check before students see it: {section}</DialogTitle>
          <DialogDescription>
            {sourceSectionLabel
              ? `${section} will get exactly the same questions as ${sectionLabelText(sourceSectionLabel)}. `
              : ""}
            Nothing changes for students until you press the button below.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-6">
          {total === 0 ? (
            <p className="type-body text-ink">
              Nothing to change. The two sections already have the same
              questions.
            </p>
          ) : null}

          {blocked.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-panel bg-surface-tint p-4">
              <p className="type-body text-ink">
                {plural(blocked.length, "question")}{" "}
                {allBlockedUnapproved
                  ? "can't be shown yet because they are not approved."
                  : "can't be shown yet because they are not ready to use."}{" "}
                They were left out.
              </p>
              <details>
                <summary className="type-body inline-flex min-h-11 cursor-pointer items-center rounded-control text-azure-500 focus-ring">
                  See which ones
                </summary>
                <ul className="mt-1 flex flex-col gap-1">
                  {blocked.map((entry) => (
                    <li className="type-body text-ink" key={entry.question.id}>
                      {entry.question.title}
                      <span className="type-small text-ink-muted">
                        {" "}
                        ({entry.reason})
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          ) : null}

          {readyAdds.length > 0 ? (
            <ItemGroup
              id="review-adds"
              title={`Will show to ${section} (${readyAdds.length})`}
            >
              {readyAdds.map((entry) => (
                <li
                  className="type-body px-3 py-2 text-ink"
                  key={entry.question.id}
                >
                  {entry.question.title}
                </li>
              ))}
            </ItemGroup>
          ) : null}

          {readyRemoves.length > 0 ? (
            <ItemGroup
              id="review-removes"
              title={`Will hide from ${section} (${readyRemoves.length})`}
            >
              {readyRemoves.map((entry) => {
                const pinned = pinnedByQuestion.get(entry.question.id) ?? 0;
                return (
                  <li
                    className="flex flex-col gap-1 px-3 py-2"
                    key={entry.question.id}
                  >
                    <span className="type-body text-ink">
                      {entry.question.title}
                    </span>
                    {pinned > 0 ? (
                      <span className="type-small text-ink">
                        {plural(pinned, "student is", "students are")} working
                        on this now; it will close for them.
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ItemGroup>
          ) : null}

          {hiddenWeeks.length > 0 ? (
            <section
              aria-labelledby="review-weeks"
              className="flex flex-col gap-3"
            >
              <h3 className="type-body-strong text-ink" id="review-weeks">
                Weeks students in {section} can&rsquo;t see yet
              </h3>
              {hiddenWeeks.map((week) => (
                <CheckboxField
                  checked={willOpen(week)}
                  description={
                    willOpen(week)
                      ? `Students will see the Week ${week.weekNumber} questions right away.`
                      : week.state === "scheduled"
                        ? `Students will see them on ${formatShortDate(week.opensAt)}.`
                        : `Students will not see them until you open Week ${week.weekNumber}.`
                  }
                  key={week.topicId}
                  label={
                    week.state === "scheduled"
                      ? `Open Week ${week.weekNumber} for ${section} now (it is set to open ${formatShortDate(week.opensAt)})`
                      : `Also open Week ${week.weekNumber} for ${section} (it is closed now)`
                  }
                  onCheckedChange={(checked) =>
                    setOpenChoice((current) => ({
                      ...current,
                      [week.topicId]: checked === true,
                    }))
                  }
                />
              ))}
            </section>
          ) : null}
        </DialogBody>

        <DialogFooter className="sm:justify-between">
          <p className="type-body text-ink">
            Only {section} changes.
            {unchangedLine ? ` ${unchangedLine}` : ""}
          </p>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
            <DialogClose asChild>
              <Button className="min-h-11" type="button" variant="secondary">
                Back to editing
              </Button>
            </DialogClose>
            <Button
              className="min-h-11"
              disabled={!canApply}
              onClick={apply}
              type="button"
            >
              {applyButtonLabel(readyAdds.length, readyRemoves.length, section)}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
