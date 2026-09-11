/**
 * Client-side guards for the "Ask AI for help" action. Kept free of React so
 * the rules (one in-flight request, one reply per exchange, no repeat for an
 * unchanged tutoring state) can be unit-tested directly.
 */

export const AI_HELP_DEFAULT_MESSAGE = "I'm stuck and not sure how to proceed.";
export const AI_HELP_REQUEST_TEXT = "Asked for AI help.";
export const AI_HELP_PENDING_LABEL = "Getting help…";
export const AI_HELP_REPEAT_NOTE =
  "Your help is in the conversation above. Try a new answer to ask again.";

/** The message sent on the student's behalf: their draft answer, or a default. */
export function aiHelpMessageFor(answer: string) {
  const trimmed = answer.trim();
  return trimmed.length > 0 ? trimmed : AI_HELP_DEFAULT_MESSAGE;
}

export type AiHelpState = {
  answer: string;
  attemptCount: number;
  hintsRevealed: number;
  questionId: string;
  sessionId: string;
  solved: boolean;
  stepsRevealed: number;
};

/**
 * Identifies one tutoring state. Every tutor transition (an answer check, a
 * hint, a solution step) advances `attemptCount`, and the session, question,
 * and message are part of the key, so two equal keys mean nothing meaningful
 * changed since the last AI-help reply.
 */
export function aiHelpStateKey(state: AiHelpState) {
  return JSON.stringify([
    state.sessionId,
    state.questionId,
    aiHelpMessageFor(state.answer),
    state.attemptCount,
    state.hintsRevealed,
    state.stepsRevealed,
    state.solved,
  ]);
}

export type AiHelpRun<T> = { started: true; value: T } | { started: false };

export type AiHelpGate = {
  readonly inFlight: boolean;
  /** Runs `task` unless another AI-help request is still in flight. */
  run<T>(task: () => Promise<T>): Promise<AiHelpRun<T>>;
};

/**
 * A synchronous single-flight lock. React state updates are asynchronous, so
 * two clicks that land before a re-render would both see an idle button; the
 * lock closes on the first call and reopens only when its task settles.
 */
export function createAiHelpGate(): AiHelpGate {
  let inFlight = false;

  return {
    get inFlight() {
      return inFlight;
    },
    async run(task) {
      if (inFlight) {
        return { started: false };
      }
      inFlight = true;
      try {
        return { started: true, value: await task() };
      } finally {
        inFlight = false;
      }
    },
  };
}

export type TranscriptEntry = {
  id: string;
  label?: string;
  role: "student" | "tutor";
  text: string;
};

export function withoutEntry<Entry extends { id: string }>(
  entries: Entry[],
  id: string,
) {
  return entries.filter((entry) => entry.id !== id);
}

/**
 * Appends the tutor's AI-help reply after the pending request bubble. If the
 * transcript already ends with the identical reply, nothing is appended and
 * the pending request bubble is withdrawn, so a repeated exchange never shows
 * the same help twice.
 */
export function appendAiHelpReply<Entry extends TranscriptEntry>(
  entries: Entry[],
  pendingRequestId: string,
  reply: Entry,
) {
  const previous = entries
    .filter((entry) => entry.id !== pendingRequestId)
    .at(-1);

  if (
    previous?.role === "tutor" &&
    previous.text === reply.text &&
    previous.label === reply.label
  ) {
    return withoutEntry(entries, pendingRequestId);
  }

  return [...entries, reply];
}
