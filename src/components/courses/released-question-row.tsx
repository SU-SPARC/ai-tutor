"use client";

import {
  ChevronDown,
  ChevronUp,
  CircleMinus,
  GripVertical,
  Undo2,
} from "lucide-react";

import { useCoursesStore } from "@/components/courses/courses-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
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
  const held = row.state === "held";
  const olderThanPublished =
    row.publishedVersion !== null &&
    row.releasedVersion !== null &&
    row.releasedVersion < row.publishedVersion;

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
        "border-b border-border/60 last:border-b-0",
        stagedRemove && "bg-muted/40",
      )}
    >
      <div className="flex items-start gap-2 px-3 py-2">
        <GripVertical
          className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/60"
          aria-hidden="true"
        />
        <div className="flex shrink-0 flex-col">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-5 w-6 text-muted-foreground"
            aria-label={`Move ${row.title} up in ${sectionLabel}`}
            disabled={index === 0}
            onClick={() => move("up")}
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-5 w-6 text-muted-foreground"
            aria-label={`Move ${row.title} down in ${sectionLabel}`}
            disabled={index >= total - 1}
            onClick={() => move("down")}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </div>

        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                "text-sm",
                stagedRemove && "text-muted-foreground line-through",
              )}
            >
              {row.title}
            </span>
            <span className="text-xs text-muted-foreground">
              v{row.releasedVersion ?? "—"}
            </span>
            {olderThanPublished ? (
              <span className="text-xs text-warning">
                ⚠ older than v{row.publishedVersion}
              </span>
            ) : null}
            {held ? (
              <Badge variant="outline" className="text-muted-foreground">
                held — version unpublished
              </Badge>
            ) : null}
            {stagedRemove ? <Badge variant="outline">removing</Badge> : null}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {expanded ? "Hide delivery settings" : "Delivery settings"}
          </span>
        </button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "h-8 w-8 shrink-0",
            stagedRemove ? "text-foreground" : "text-muted-foreground",
          )}
          aria-label={
            stagedRemove
              ? `Undo staged removal of ${row.title} from ${sectionLabel}`
              : `Stage removal of ${row.title} from ${sectionLabel}`
          }
          onClick={onToggleRemove}
        >
          {stagedRemove ? (
            <Undo2 className="h-4 w-4" />
          ) : (
            <CircleMinus className="h-4 w-4" />
          )}
        </Button>
      </div>

      {expanded ? (
        <div className="flex flex-col gap-3 border-t border-border/60 bg-muted/20 px-3 py-3 pl-11">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Attempts allowed
              <Input
                type="number"
                min={MIN_ATTEMPTS}
                max={MAX_ATTEMPTS}
                className="h-8 w-20 py-1 text-sm"
                value={row.delivery.attemptsAllowed}
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
              />
            </label>

            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              Hints
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-20"
                aria-pressed={row.delivery.hintsEnabled}
                aria-label={`Hints for ${row.title} in ${sectionLabel}`}
                onClick={() =>
                  updateDelivery({ hintsEnabled: !row.delivery.hintsEnabled })
                }
              >
                {row.delivery.hintsEnabled ? "On" : "Off"}
              </Button>
            </div>

            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Show solution after
              <NativeSelect
                className="h-8 w-[10rem] py-1 text-sm"
                value={row.delivery.solutionReveal}
                onChange={(event) =>
                  updateDelivery({
                    solutionReveal: event.target.value as SolutionRevealPolicy,
                  })
                }
              >
                {SOLUTION_REVEAL_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {SOLUTION_REVEAL_LABELS[value]}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Saved for this section only. The question itself is unchanged.
          </p>
        </div>
      ) : null}
    </li>
  );
}
