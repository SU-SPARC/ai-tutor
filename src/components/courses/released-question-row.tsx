"use client";

import { useId } from "react";
import { History, PauseCircle } from "lucide-react";

import { StagedChip } from "@/components/courses/course-status";
import { useCoursesStore } from "@/components/courses/courses-store";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { StatusChip } from "@/components/ui/status-chip";
import { toast } from "@/components/ui/toast";
import type { ReleasedQuestion } from "@/lib/courses/selectors";
import type {
  DeliverySettings,
  SectionId,
  SolutionRevealPolicy,
} from "@/lib/courses/types";
import { cn } from "@/lib/utils";

const UNDO_TOAST_MS = 15_000;

const SOLUTION_REVEAL_LABELS: Record<SolutionRevealPolicy, string> = {
  never: "Never",
  after_2_wrong: "After 2 wrong answers",
  after_3_wrong: "After 3 wrong answers",
  after_correct: "After a correct answer",
};

const SOLUTION_REVEAL_ORDER: SolutionRevealPolicy[] = [
  "never",
  "after_2_wrong",
  "after_3_wrong",
  "after_correct",
];

const MIN_ATTEMPTS = 1;
const MAX_ATTEMPTS = 10;

/**
 * One question the section is shown. Order and delivery settings change for
 * students right away (the reducer applies them directly), and each change
 * says so in a toast with Undo. Only removal waits: the row shows "Will hide
 * (not saved yet)" and an "Undo remove" button until the professor saves.
 */
export function ReleasedQuestionRow({
  expanded,
  index,
  onToggleExpanded,
  onToggleRemove,
  reordering,
  row,
  sectionLabel,
  sectionId,
  stagedRemove,
  total,
}: {
  expanded: boolean;
  index: number;
  onToggleExpanded: () => void;
  onToggleRemove: () => void;
  /** Move up / Move down appear only while the pane's Reorder is on. */
  reordering: boolean;
  row: ReleasedQuestion;
  sectionId: SectionId;
  /** Already in words: "Section 1". */
  sectionLabel: string;
  /** True while this row is waiting to be hidden. */
  stagedRemove: boolean;
  total: number;
}) {
  const { dispatch } = useCoursesStore();
  const settingsId = useId();
  const held = row.state === "held";
  const olderThanPublished =
    row.publishedVersion !== null &&
    row.releasedVersion !== null &&
    row.releasedVersion < row.publishedVersion;
  const first = index === 0;
  const last = index >= total - 1;

  const move = (direction: "up" | "down") => {
    dispatch({
      type: "section/moveReleased",
      sectionId,
      questionId: row.id,
      direction,
    });
    toast({
      title: `Moved “${row.title}” ${direction} for ${sectionLabel}.`,
      description: "Students see the new order right away.",
      action: {
        label: "Undo",
        onClick: () =>
          dispatch({
            type: "section/moveReleased",
            sectionId,
            questionId: row.id,
            direction: direction === "up" ? "down" : "up",
          }),
      },
      duration: UNDO_TOAST_MS,
    });
  };

  const updateDelivery = (patch: Partial<DeliverySettings>) => {
    const previous = { ...row.delivery };
    dispatch({
      type: "section/updateDelivery",
      sectionId,
      questionId: row.id,
      patch,
    });
    toast({
      title: `Settings for “${row.title}” changed for ${sectionLabel}.`,
      description: "Students see this right away.",
      action: {
        label: "Undo",
        onClick: () =>
          dispatch({
            type: "section/updateDelivery",
            sectionId,
            questionId: row.id,
            patch: previous,
          }),
      },
      duration: UNDO_TOAST_MS,
    });
  };

  return (
    <li
      className={cn(
        "border-b border-rule last:border-b-0",
        stagedRemove && "bg-surface-tint",
      )}
    >
      <div className="flex flex-wrap items-center gap-3 px-3 py-2">
        <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
          <p
            className={cn(
              "type-body text-ink",
              stagedRemove && "text-ink-muted line-through",
            )}
          >
            {row.title}
          </p>
          {olderThanPublished || held || stagedRemove ? (
            <div className="flex flex-wrap items-center gap-2">
              {olderThanPublished ? (
                <StatusChip
                  icon={History}
                  label="Shown (older version)"
                  tone="review"
                />
              ) : null}
              {held ? (
                <StatusChip
                  icon={PauseCircle}
                  label="Paused: this version was withdrawn"
                  tone="neutral"
                />
              ) : null}
              {stagedRemove ? <StagedChip kind="remove" /> : null}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {reordering ? (
            <>
              <Button
                aria-disabled={first || undefined}
                aria-label={`Move ${row.title} up for ${sectionLabel}`}
                className="min-h-11"
                onClick={() => {
                  if (!first) {
                    move("up");
                  }
                }}
                type="button"
                variant="outline"
              >
                Move up
              </Button>
              <Button
                aria-disabled={last || undefined}
                aria-label={`Move ${row.title} down for ${sectionLabel}`}
                className="min-h-11"
                onClick={() => {
                  if (!last) {
                    move("down");
                  }
                }}
                type="button"
                variant="outline"
              >
                Move down
              </Button>
            </>
          ) : (
            <>
              <Button
                aria-controls={settingsId}
                aria-expanded={expanded}
                aria-label={`Settings for ${row.title}`}
                className="min-h-11"
                onClick={onToggleExpanded}
                type="button"
                variant={expanded ? "secondary" : "outline"}
              >
                Settings
              </Button>
              <Button
                aria-label={
                  stagedRemove
                    ? `Undo remove: keep ${row.title} for ${sectionLabel}`
                    : `Remove ${row.title} from ${sectionLabel}`
                }
                className="min-h-11"
                onClick={onToggleRemove}
                type="button"
                variant="outline"
              >
                {stagedRemove ? "Undo remove" : "Remove"}
              </Button>
            </>
          )}
        </div>
      </div>

      {expanded && !reordering ? (
        <div
          className="flex flex-col gap-3 bg-surface-tint px-3 py-3"
          id={settingsId}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              description="Changes for students right away."
              label="Tries allowed, e.g. 3"
            >
              <Input
                inputMode="numeric"
                max={MAX_ATTEMPTS}
                min={MIN_ATTEMPTS}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10);
                  if (!Number.isFinite(parsed)) {
                    return;
                  }
                  updateDelivery({
                    attemptsAllowed: Math.min(
                      MAX_ATTEMPTS,
                      Math.max(MIN_ATTEMPTS, parsed),
                    ),
                  });
                }}
                type="number"
                value={row.delivery.attemptsAllowed}
              />
            </Field>
            <Field label="Show the worked solution">
              <NativeSelect
                onChange={(event) =>
                  updateDelivery({
                    solutionReveal: event.target.value as SolutionRevealPolicy,
                  })
                }
                value={row.delivery.solutionReveal}
              >
                {SOLUTION_REVEAL_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {SOLUTION_REVEAL_LABELS[value]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <CheckboxField
            checked={row.delivery.hintsEnabled}
            label="Students can open hints"
            onCheckedChange={(checked) =>
              updateDelivery({ hintsEnabled: checked === true })
            }
          />
          <p className="type-small text-ink">
            These settings are for {sectionLabel} only. The question itself is
            unchanged.
          </p>
        </div>
      ) : null}
    </li>
  );
}
