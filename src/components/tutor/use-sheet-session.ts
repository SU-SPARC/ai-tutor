"use client";

/**
 * A lightweight live tutor session for a single question sheet (the landing
 * hero, a topic preview). The full practice workspace keeps its own richer
 * state; this hook covers only "check an answer" and "reveal the next hint".
 *
 * The session is created lazily on the first `check`/`hint` so a sheet that is
 * merely rendered never writes anything, and it reuses the same idempotency
 * discipline as the workspace via `createTutorSession`.
 */

import { useCallback, useRef, useState } from "react";

import {
  chatMessageForResponse,
  createTutorSession,
  sendTutorRequest,
  sessionErrorFor,
  sessionWithProgress,
  storeTutorSessionId,
  type SessionErrorState,
} from "@/components/tutor/tutor-client";
import type { TutorSessionDto } from "@/lib/api/tutor-session-dto";
import type { TutorResponse, TutorVerdict } from "@/lib/types";

export type SheetSessionStatus =
  | "idle"
  | "creating"
  | "ready"
  | "checking"
  | "hinting"
  | "error";

export type UseSheetSessionOptions = {
  enabled?: boolean;
  /** Hint total for sessions whose DTO does not carry the question summary. */
  hintCount?: number;
  questionId: string;
  topicId?: string;
};

export type SheetSessionProgress = {
  attemptCount?: number;
  hintsRevealed: string[];
  lastMessage: string;
  solved: boolean;
  verdict: TutorVerdict;
};

/**
 * The student-visible result of one tutor exchange. Pure so the mapping can be
 * tested without a DOM.
 */
export function sheetProgressFromResponse(
  response: TutorResponse,
  hintTotal: number,
): SheetSessionProgress {
  const revealed = Math.min(
    hintTotal > 0 ? hintTotal : response.hints.length,
    response.progress?.hintsRevealed ?? response.hints.length,
  );
  return {
    attemptCount: response.progress?.attemptCount,
    hintsRevealed: response.hints.slice(0, Math.max(0, revealed)),
    lastMessage: chatMessageForResponse(response).text,
    solved: response.progress?.solved ?? response.verdict === "correct",
    verdict: response.verdict,
  };
}

export function useSheetSession({
  enabled = true,
  hintCount,
  questionId,
  topicId,
}: UseSheetSessionOptions) {
  const [status, setStatus] = useState<SheetSessionStatus>("idle");
  const [session, setSession] = useState<TutorSessionDto | null>(null);
  const [verdict, setVerdict] = useState<TutorVerdict | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [hintsRevealed, setHintsRevealed] = useState<string[]>([]);
  const [error, setError] = useState<SessionErrorState | null>(null);
  // A synchronous lock: React state lands after a re-render, so two rapid
  // clicks would otherwise both see an idle sheet and start two requests.
  const busyRef = useRef(false);
  const sessionRef = useRef<TutorSessionDto | null>(null);
  const forceNewRef = useRef(false);

  const hintTotal = hintCount ?? session?.question?.hintCount ?? 0;
  const solved = session?.solved ?? false;
  const attemptCount = session?.attemptCount ?? 0;

  const ensureSession = useCallback(async () => {
    if (sessionRef.current) {
      return sessionRef.current;
    }
    setStatus("creating");
    const created = await createTutorSession(questionId, {
      forceNew: forceNewRef.current,
    });
    forceNewRef.current = false;
    storeTutorSessionId(questionId, created.id);
    sessionRef.current = created;
    setSession(created);
    return created;
  }, [questionId]);

  const exchange = useCallback(
    async (
      mode: "check" | "hint",
      answer: string,
      busyStatus: SheetSessionStatus,
    ) => {
      if (!enabled || busyRef.current) return;
      busyRef.current = true;
      setError(null);

      try {
        const active = await ensureSession();
        setStatus(busyStatus);
        const response = await sendTutorRequest({
          answer,
          mode,
          questionId,
          sessionId: active.id,
          topicId: topicId ?? active.question?.topicId ?? "",
        });
        const progress = sheetProgressFromResponse(
          response,
          hintCount ?? active.question?.hintCount ?? 0,
        );
        const next = sessionWithProgress(active, response) ?? active;
        sessionRef.current = next;
        setSession(next);
        setVerdict(progress.verdict);
        setLastMessage(progress.lastMessage);
        if (progress.hintsRevealed.length > 0) {
          setHintsRevealed(progress.hintsRevealed);
        }
        setStatus("ready");
      } catch (caught) {
        // Sheets are decorative surfaces: a failure becomes readable state
        // (with a sign-in link for SIGN_IN_REQUIRED) and never throws.
        setError(sessionErrorFor(caught));
        setStatus("error");
      } finally {
        busyRef.current = false;
      }
    },
    [enabled, ensureSession, hintCount, questionId, topicId],
  );

  const check = useCallback(
    async (answer: string) => {
      const trimmed = answer.trim();
      if (!trimmed) return;
      await exchange("check", trimmed, "checking");
    },
    [exchange],
  );

  const hint = useCallback(async () => {
    if (hintTotal > 0 && hintsRevealed.length >= hintTotal) return;
    await exchange("hint", "", "hinting");
  }, [exchange, hintTotal, hintsRevealed.length]);

  const reset = useCallback(() => {
    busyRef.current = false;
    sessionRef.current = null;
    forceNewRef.current = true;
    setSession(null);
    setStatus("idle");
    setVerdict(null);
    setLastMessage(null);
    setHintsRevealed([]);
    setError(null);
  }, []);

  return {
    attemptCount,
    check,
    error,
    hint,
    hintsRevealed,
    hintTotal,
    lastMessage,
    reset,
    session,
    solved,
    status,
    verdict,
  };
}
