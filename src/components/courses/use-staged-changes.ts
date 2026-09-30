"use client";

import { useCallback, useMemo, useState } from "react";

import type { QuestionId, StagedReleaseChange } from "@/lib/courses/types";

export type StagedKind = "add" | "remove";

export type StagedChanges = {
  /** questionId → what the professor staged for it. */
  staged: ReadonlyMap<QuestionId, StagedKind>;
  changes: StagedReleaseChange[];
  addCount: number;
  removeCount: number;
  count: number;
  kindFor: (questionId: QuestionId) => StagedKind | undefined;
  /** Stage the only change that makes sense for this id, or clear it. */
  toggle: (questionId: QuestionId) => void;
  stage: (questionId: QuestionId, kind: StagedKind) => void;
  unstage: (questionId: QuestionId) => void;
  clear: () => void;
  /** Put back a buffer taken earlier (Undo after "Discard all changes"). */
  restore: (snapshot: ReadonlyMap<QuestionId, StagedKind>) => void;
};

/**
 * The S3 staging buffer.
 *
 * Nothing here touches the store: a professor's Add / Remove clicks wait here
 * ("Not saved yet") until the review dialog saves them in one dispatch. Two
 * invariants keep the two panes from ever disagreeing with the store:
 *
 * - staging an add for a question the section already has is a no-op, and
 *   staging a remove for one it does not have is a no-op — so a staged change
 *   always describes a real difference;
 * - staging the same change twice clears it, which is what a professor means
 *   when they click the same ⊕ again.
 *
 * `releasedIds` is every question with an availability row in this section,
 * held rows included, matching what `previewReleaseChanges` treats as
 * removable.
 */
export function useStagedChanges(
  releasedIds: ReadonlySet<QuestionId>,
): StagedChanges {
  const [staged, setStaged] = useState<ReadonlyMap<QuestionId, StagedKind>>(
    () => new Map(),
  );

  const stage = useCallback(
    (questionId: QuestionId, kind: StagedKind) => {
      if (kind === "add" && releasedIds.has(questionId)) {
        return;
      }
      if (kind === "remove" && !releasedIds.has(questionId)) {
        return;
      }
      setStaged((previous) => {
        const next = new Map(previous);
        if (next.get(questionId) === kind) {
          next.delete(questionId);
        } else {
          next.set(questionId, kind);
        }
        return next;
      });
    },
    [releasedIds],
  );

  const toggle = useCallback(
    (questionId: QuestionId) => {
      stage(questionId, releasedIds.has(questionId) ? "remove" : "add");
    },
    [releasedIds, stage],
  );

  const unstage = useCallback((questionId: QuestionId) => {
    setStaged((previous) => {
      if (!previous.has(questionId)) {
        return previous;
      }
      const next = new Map(previous);
      next.delete(questionId);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setStaged((previous) => (previous.size === 0 ? previous : new Map()));
  }, []);

  const restore = useCallback(
    (snapshot: ReadonlyMap<QuestionId, StagedKind>) => {
      setStaged(new Map(snapshot));
    },
    [],
  );

  const kindFor = useCallback(
    (questionId: QuestionId) => staged.get(questionId),
    [staged],
  );

  return useMemo(() => {
    const changes: StagedReleaseChange[] = [];
    let addCount = 0;
    let removeCount = 0;
    for (const [questionId, kind] of staged) {
      changes.push({ kind, questionId });
      if (kind === "add") {
        addCount += 1;
      } else {
        removeCount += 1;
      }
    }
    return {
      staged,
      changes,
      addCount,
      removeCount,
      count: changes.length,
      kindFor,
      toggle,
      stage,
      unstage,
      clear,
      restore,
    };
  }, [staged, kindFor, toggle, stage, unstage, clear, restore]);
}
