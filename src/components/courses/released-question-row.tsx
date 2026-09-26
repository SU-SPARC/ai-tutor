"use client";

import { useId } from "react";
import {
  ChevronDown,
  ChevronUp,
  CircleMinus,
  History,
  PauseCircle,
  SlidersHorizontal,
  Undo2,
} from "lucide-react";

import { StagedChip } from "@/components/courses/course-status";
import { useCoursesStore } from "@/components/courses/courses-store";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { StatusChip } from "@/components/ui/status-chip";
import type { ReleasedQuestion } from "@/lib/courses/selectors";
import type { SectionId, SolutionRevealPolicy } from "@/lib/courses/types";
import { cn } from "@/lib/utils";

const SOLUTION_REVEAL_LABELS: Record<SolutionRevealPolicy, string> = {
  never: "Never",
  after_2_wrong: "After 2 wrong",
  after_3_wrong: "After 3 wrong",
  after_correct: "After correct",
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
 * One question the section already has. Order and delivery settings save as
 * they change (the reducer applies them directly); only removal is staged,
 * shown with a "Removing" chip and an undo button until it is applied.
 */
export function ReleasedQuestionRow({
  expanded,
  index,
  onToggleExpanded,
  onToggleRemove,
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
  row: ReleasedQuestion;
  sectionId: SectionId;
  sectionLabel: string;
  /** True while this row is queued for removal in the staging buffer. */
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

  const move = (direction: "up" | "down") =>
    dispatch({
      type: "section/moveReleased",
      sectionId,
      questionId: row.id,
      direction,
    });

  const updateDelivery = (patch: Partial<typeof row.delivery>) =>
    dispatch({
      type: "section/updateDelivery",
      sectionId,
      questionId: row.id,
      patch,
    });

  return (
    <li
      className={cn(
        "border-b border-rule last:border-b-0",
        stagedRemove && "bg-surface-tint",
      )}
    >
      <div className="flex items-start gap-2 px-3 py-2">
        <div className="flex shrink-0 items-center">
          <Button
            aria-disabled={first || undefined}
            aria-label={`Move ${row.title} up in ${sectionLabel}`}
            onClick={() => {
              if (!first) {
                move("up");
              }
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <ChevronUp aria-hidden="true" />
          </Button>
          <Button
            aria-disabled={last || undefined}
            aria-label={`Move ${row.title} down in ${sectionLabel}`}
            onClick={() => {
              if (!last) {
                move("down");
              }
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <ChevronDown aria-hidden="true" />
          </Button>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1">
          <p
            className={cn(
              "type-small text-ink",
              stagedRemove && "text-ink-muted line-through",
            )}
          >
            {row.title}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="type-caption tabular">
              v{row.releasedVersion ?? "—"}
            </span>
            {olderThanPublished ? (
              <StatusChip
                icon={History}
                label={`Older than v${row.publishedVersion}`}
                tone="review"
              />
            ) : null}
            {held ? (
              <StatusChip
                icon={PauseCircle}
                label="Held · version unpublished"
                tone="neutral"
              />
            ) : null}
            {stagedRemove ? <StagedChip kind="remove" /> : null}
          </div>
        </div>

        <Button
          aria-controls={settingsId}
          aria-expanded={expanded}
          aria-label={`Delivery settings for ${row.title}`}
          className="shrink-0"
          onClick={onToggleExpanded}
          size="icon-sm"
          type="button"
          variant={expanded ? "secondary" : "ghost"}
        >
          <SlidersHorizontal aria-hidden="true" />
        </Button>
        <Button
          aria-label={
            stagedRemove
              ? `Undo staged removal of ${row.title} from ${sectionLabel}`
              : `Stage removal of ${row.title} from ${sectionLabel}`
          }
          className="shrink-0"
          onClick={onToggleRemove}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {stagedRemove ? (
            <Undo2 aria-hidden="true" />
          ) : (
            <CircleMinus aria-hidden="true" />
          )}
        </Button>
      </div>

      {expanded ? (
        <div
          className="flex flex-col gap-3 bg-surface-tint px-3 py-3 sm:pl-18"
          id={settingsId}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Attempts allowed">
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
            <Field label="Show solution after">
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
            label="Hints on"
            onCheckedChange={(checked) =>
              updateDelivery({ hintsEnabled: checked === true })
            }
          />
          <p className="type-caption">
            Saved for {sectionLabel} only. The question itself is unchanged.
          </p>
        </div>
      ) : null}
    </li>
  );
}
