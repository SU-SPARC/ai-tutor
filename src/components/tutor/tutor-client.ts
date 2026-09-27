/**
 * The browser-side tutor API client: session creation and recovery, the three
 * tutor endpoints, their idempotency keys, and the pure helpers that turn a
 * tutor response into what a student reads. Kept free of React so both the
 * full practice workspace and the lightweight sheet hook share one client, and
 * so the recovery rules can be unit-tested directly.
 *
 * Every `window`/`localStorage` access is guarded: the durable server session
 * stays usable when browser storage is blocked, full, or absent.
 */

import { anonymousTutorSessionStorageKey } from "@/lib/auth/anonymous-student";
import { signInPath } from "@/lib/auth/return-path";
import type { TutorSessionDto } from "@/lib/api/tutor-session-dto";
import type {
  StudentPracticeQuestion,
  TutorMode,
  TutorResponse,
} from "@/lib/types";

export type ChatMessageTone =
  | "correct"
  | "incorrect"
  | "guidance"
  | "notice"
  | "neutral";

export type ChatMessage = {
  id: string;
  label?: string;
  note?: string;
  role: "student" | "tutor";
  stepLabel?: string;
  text: string;
  tone?: ChatMessageTone;
};

export type SessionErrorState = {
  code?: string;
  message: string;
  signInHref?: string;
};

export type TutorSessionPayload = {
  code?: string;
  error?: string;
  session?: TutorSessionDto;
};

export type TutorErrorPayload = {
  code?: string;
  error?: string;
};

export const SAFE_TUTOR_ERROR_CODES = new Set([
  "MALFORMED_TUTOR_REQUEST",
  "MALFORMED_TUTOR_SESSION_REQUEST",
  "QUESTION_UNAVAILABLE",
  "TUTOR_AI_IN_PROGRESS",
  "TUTOR_ENDPOINT_RETIRED",
  "TUTOR_RATE_LIMITED",
  "TUTOR_REQUEST_INTERRUPTED",
  "TUTOR_REQUEST_TOO_LARGE",
  "TUTOR_SESSION_COMPLETE",
  "TUTOR_SESSION_STALE",
  "TUTOR_SESSION_UNAVAILABLE",
]);

export const SIGN_IN_REQUIRED_CODE = "SIGN_IN_REQUIRED";
export const SIGN_IN_REQUIRED_MESSAGE =
  "Sign in to start practicing. Your progress is saved to your account.";

/**
 * A linked "similar problem" is only offered from a published question's
 * session; a reserve-practice session already is the similar problem.
 */
export function shouldOfferSimilarPractice(
  session?: Pick<TutorSessionDto, "practiceContext"> | null,
) {
  return Boolean(
    session && (session.practiceContext ?? "published") === "published",
  );
}
export const UNREADABLE_MESSAGE_PREFIX = "I could not read";

export class TutorClientRequestError extends Error {
  readonly code?: string;
  readonly requestId?: string;
  readonly status: number;

  constructor(
    message: string,
    options: { code?: string; requestId?: string; status: number },
  ) {
    super(message);
    this.name = "TutorClientRequestError";
    this.code = options.code;
    this.requestId = options.requestId;
    this.status = options.status;
  }
}

/**
 * Picks the question a student should move to after finishing the current
 * one: the next unsolved question later in the topic list, then any earlier
 * unsolved question, otherwise nothing (the topic is complete).
 */
export function nextQuestionAfter<
  Question extends Pick<StudentPracticeQuestion, "id">,
>(
  currentQuestionId: string | undefined,
  topicQuestions: Question[],
  solvedQuestionIds: ReadonlySet<string>,
): Question | undefined {
  const index = topicQuestions.findIndex(
    (question) => question.id === currentQuestionId,
  );
  const later = topicQuestions
    .slice(index + 1)
    .find((question) => !solvedQuestionIds.has(question.id));
  if (later) {
    return later;
  }
  return topicQuestions.find(
    (question, position) =>
      position !== index && !solvedQuestionIds.has(question.id),
  );
}

/**
 * Translates a tutor response into the transcript entry the student sees.
 * Format guidance ("I could not read that…") and blocked help are shown as
 * notices, never as wrong attempts, matching the engine, which does not count
 * them as incorrect.
 */
export function chatMessageForResponse(
  response: Pick<TutorResponse, "message" | "misconceptions" | "verdict">,
): Omit<ChatMessage, "id"> {
  if (response.verdict === "correct") {
    return {
      label: "Correct",
      role: "tutor",
      text: response.message,
      tone: "correct",
    };
  }

  if (response.verdict === "incorrect") {
    return {
      label: "Not quite",
      note: response.misconceptions[0],
      role: "tutor",
      text: stripNotQuitePrefix(response.message),
      tone: "incorrect",
    };
  }

  if (response.verdict === "blocked") {
    return {
      label: "Extra help is unavailable right now",
      role: "tutor",
      text: response.message,
      tone: "notice",
    };
  }

  const unreadable = response.message.startsWith(UNREADABLE_MESSAGE_PREFIX);
  return {
    label: unreadable ? "Couldn't read that answer" : undefined,
    note: unreadable
      ? "This was not counted as an attempt. Retype your answer using the format shown and try again."
      : undefined,
    role: "tutor",
    text: response.message,
    tone: "guidance",
  };
}

export function stripNotQuitePrefix(message: string) {
  const stripped = message.replace(/^not quite[.!]?\s*/i, "").trim();
  return stripped.length > 0 ? stripped : "Give it another try.";
}

export async function createOrResumeTutorSession(
  questionId: string,
  preferredSessionId?: string,
) {
  if (preferredSessionId) {
    try {
      const preferredSession = await fetchTutorSession(preferredSessionId);

      if (preferredSession.questionId === questionId) {
        storeTutorSessionId(questionId, preferredSession.id);
        return preferredSession;
      }
    } catch (error) {
      // The session may be expired, unpublished, or owned by someone else.
      // Fall back without revealing which condition applied.
      if (!canReplaceUnavailableSession(error)) {
        throw error;
      }
    }
  }

  const storedSessionId = readTutorSessionId(questionId);

  if (storedSessionId) {
    try {
      const session = await fetchTutorSession(storedSessionId);

      if (session.questionId === questionId) {
        return session;
      }
    } catch (error) {
      if (!canReplaceUnavailableSession(error)) {
        throw error;
      }
      clearTutorSessionId(questionId);
    }
  }

  const session = await createTutorSession(questionId);
  storeTutorSessionId(questionId, session.id);
  return session;
}

export function readTutorSessionId(questionId: string) {
  try {
    return window.localStorage.getItem(
      anonymousTutorSessionStorageKey(questionId),
    );
  } catch {
    return null;
  }
}

export function storeTutorSessionId(questionId: string, sessionId: string) {
  try {
    window.localStorage.setItem(
      anonymousTutorSessionStorageKey(questionId),
      sessionId,
    );
  } catch {
    // The server session remains usable even if browser continuity storage is
    // unavailable or full.
  }
}

export function clearTutorSessionId(questionId: string) {
  try {
    window.localStorage.removeItem(anonymousTutorSessionStorageKey(questionId));
  } catch {
    // A stale local value is harmless because ownership is checked server-side.
  }
}

export async function createTutorSession(
  questionId: string,
  options: { forceNew?: boolean } = {},
) {
  const idempotencyKey = pendingSessionCreationKey(
    questionId,
    options.forceNew,
  );
  const result = await retryTutorRequest(() =>
    fetch("/api/tutor/session", {
      body: JSON.stringify({
        idempotencyKey,
        questionId,
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    }),
  );
  const session = await readTutorSessionPayload(result);
  clearPendingSessionCreationKey(questionId, idempotencyKey);
  return session;
}

export async function fetchTutorSession(sessionId: string) {
  const result = await retryTutorRequest(() =>
    fetch(`/api/tutor/session/${sessionId}`),
  );
  return readTutorSessionPayload(result);
}

export async function requestTutorResponse(input: {
  /** Context for help only: the server never grades an aiHelp request. */
  aiHelp?: boolean;
  allowLlmFallback?: boolean;
  answer: string;
  mode: TutorMode;
  questionId: string;
  sessionId: string;
  topicId: string;
}) {
  const eventId = pendingTutorEventId(input);
  const result = await retryTutorRequest(() =>
    fetch("/api/tutor/respond", {
      body: JSON.stringify({ ...input, eventId }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    }),
  );
  const payload = (await result
    .json()
    .catch(() => ({}))) as Partial<TutorResponse> & TutorErrorPayload;

  if (!result.ok || !payload.verdict) {
    if (result.status < 500) {
      clearPendingTutorEventId(input.sessionId, eventId);
    }
    throw tutorClientError(
      result,
      payload,
      "The tutor could not complete this request. Please try again.",
    );
  }

  clearPendingTutorEventId(input.sessionId, eventId);
  return payload as TutorResponse;
}

/** The spec name for the respond endpoint; `requestTutorResponse` is the
 * original name the practice workspace and its tests use. */
export { requestTutorResponse as sendTutorRequest };

async function retryTutorRequest(request: () => Promise<Response>) {
  let lastResponse: Response | undefined;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await request();
      if (response.status < 500 || attempt === 1) {
        return response;
      }
      lastResponse = response;
    } catch {
      if (attempt === 1) {
        throw new TutorClientRequestError(
          "The connection was interrupted. We could not confirm whether the request reached the tutor. Reopen this session before resubmitting so any saved progress can be recovered.",
          { code: "NETWORK_INTERRUPTED", status: 0 },
        );
      }
    }
  }

  return lastResponse!;
}

async function readTutorSessionPayload(result: Response) {
  const payload = (await result
    .json()
    .catch(() => ({}))) as TutorSessionPayload;

  if (!result.ok || !payload.session) {
    throw tutorClientError(
      result,
      payload,
      "The tutor session could not be loaded safely. Please try again.",
    );
  }

  return payload.session;
}

export function tutorClientError(
  response: Response,
  payload: TutorErrorPayload,
  fallbackMessage: string,
) {
  if (response.status === 401) {
    return new TutorClientRequestError(SIGN_IN_REQUIRED_MESSAGE, {
      code: SIGN_IN_REQUIRED_CODE,
      requestId: response.headers.get("x-request-id") ?? undefined,
      status: response.status,
    });
  }
  const message =
    response.status >= 500
      ? "The tutor is temporarily unavailable. Nothing was saved from that request. Please try again shortly."
      : response.status >= 400 &&
          payload.code &&
          SAFE_TUTOR_ERROR_CODES.has(payload.code) &&
          typeof payload.error === "string"
        ? payload.error
        : fallbackMessage;
  return new TutorClientRequestError(message, {
    code: payload.code,
    requestId: response.headers.get("x-request-id") ?? undefined,
    status: response.status,
  });
}

export function canReplaceUnavailableSession(error: unknown) {
  return (
    error instanceof TutorClientRequestError &&
    error.status === 404 &&
    (!error.code || error.code === "TUTOR_SESSION_UNAVAILABLE")
  );
}

export function pendingSessionCreationKey(
  questionId: string,
  forceNew = false,
) {
  const storageKey = `ai-tutor:pending-session:${questionId}`;
  try {
    const existing = forceNew ? null : window.localStorage.getItem(storageKey);
    const idempotencyKey = existing || createClientId("session");
    window.localStorage.setItem(storageKey, idempotencyKey);
    return idempotencyKey;
  } catch {
    return createClientId("session");
  }
}

export function clearPendingSessionCreationKey(
  questionId: string,
  idempotencyKey: string,
) {
  const storageKey = `ai-tutor:pending-session:${questionId}`;
  try {
    if (window.localStorage.getItem(storageKey) === idempotencyKey) {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // A missing browser store does not affect the durable server session.
  }
}

export function pendingTutorEventId(input: {
  aiHelp?: boolean;
  allowLlmFallback?: boolean;
  answer: string;
  mode: TutorMode;
  questionId: string;
  sessionId: string;
}) {
  const storageKey = `ai-tutor:pending-event:${input.sessionId}`;
  const fingerprint = clientInputFingerprint(
    JSON.stringify({
      aiHelp: Boolean(input.aiHelp),
      allowLlmFallback: Boolean(input.allowLlmFallback),
      answer: input.answer,
      mode: input.mode,
      questionId: input.questionId,
    }),
  );
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "null",
    ) as { eventId?: unknown; fingerprint?: unknown } | null;
    if (
      stored &&
      stored.fingerprint === fingerprint &&
      typeof stored.eventId === "string"
    ) {
      return stored.eventId;
    }
    const eventId = createClientId("event");
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ eventId, fingerprint }),
    );
    return eventId;
  } catch {
    return createClientId("event");
  }
}

export function clearPendingTutorEventId(sessionId: string, eventId: string) {
  const storageKey = `ai-tutor:pending-event:${sessionId}`;
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "null",
    ) as { eventId?: unknown } | null;
    if (stored?.eventId === eventId) {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // A missing browser store does not affect server idempotency.
  }
}

export function clientInputFingerprint(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function responseUsageStatusText(
  response: Pick<TutorResponse, "responseLabel" | "source">,
) {
  if (
    response.source === "llm" ||
    response.source === "cache" ||
    response.responseLabel === "general_ai_help"
  ) {
    return "Using AI fallback";
  }

  if (response.responseLabel === "generated_approved_content") {
    return "Using approved generated content";
  }

  if (response.responseLabel === "private_reference_grounded_explanation") {
    return "Using private reference grounded explanation";
  }

  if (response.responseLabel === "approved_course_content") {
    return "Using saved course content";
  }

  return undefined;
}

export function shouldShowRetrievedContext(
  response: Pick<TutorResponse, "responseLabel" | "retrievedContext">,
) {
  return (
    response.retrievedContext.length > 0 &&
    response.responseLabel !== "private_reference_grounded_explanation"
  );
}

export function createClientId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Math.random().toString(36).slice(2)}`;
}

export function currentPracticeSignInHref() {
  if (typeof window === "undefined") {
    return signInPath("/practice");
  }
  const { pathname, search } = window.location;
  return signInPath(
    pathname.startsWith("/practice") ? `${pathname}${search}` : "/practice",
  );
}

export function sessionWithProgress(
  session: TutorSessionDto | null,
  response: TutorResponse,
) {
  if (!session || !response.progress) {
    return session;
  }

  return {
    ...session,
    aiFallbackUsed: response.progress.llmUsed,
    attemptCount: response.progress.attemptCount,
    currentState: response.progress.state,
    revealedHints: response.progress.hintsRevealed,
    revealedSteps: response.progress.stepsRevealed,
    solved: response.progress.solved,
    wrongAttemptCount: response.progress.wrongAttemptCount,
  };
}

export function recoveryMessages(
  session: Pick<
    TutorSessionDto,
    "attempts" | "disclosedAnswerExplanation" | "disclosedSolutionSteps"
  >,
  question: StudentPracticeQuestion | undefined,
): ChatMessage[] {
  if (!question) {
    return [];
  }

  return session.attempts.flatMap((attempt, attemptIndex) => {
    const messages: ChatMessage[] = [];
    if (attempt.submittedAnswer) {
      messages.push({
        id: `recovered-student-${attemptIndex}`,
        role: "student",
        text: attempt.submittedAnswer,
      });
    }

    if (attempt.mode === "full_solution") {
      (session.disclosedSolutionSteps ?? []).forEach(
        (step, stepIndex, steps) => {
          messages.push({
            id: `recovered-step-${attemptIndex}-${stepIndex}`,
            role: "tutor",
            stepLabel: `Step ${stepIndex + 1} of ${steps.length}`,
            text: step,
            tone: "neutral",
          });
        },
      );
    } else if (attempt.verdict === "correct") {
      messages.push({
        id: `recovered-tutor-${attemptIndex}`,
        label: "Correct",
        role: "tutor",
        text:
          session.disclosedAnswerExplanation ??
          "You already answered this question correctly.",
        tone: "correct",
      });
    } else if (attempt.verdict === "incorrect") {
      messages.push({
        id: `recovered-tutor-${attemptIndex}`,
        label: "Not quite",
        note: attempt.misconceptionFeedback[0],
        role: "tutor",
        text:
          attempt.misconceptionFeedback.length > 0
            ? "There is a likely misconception to check first."
            : "Give it another try.",
        tone: "incorrect",
      });
    }

    return messages;
  });
}

export function sessionErrorFor(error: unknown): SessionErrorState {
  if (error instanceof TutorClientRequestError) {
    return {
      code: error.code,
      message: error.message,
      signInHref:
        error.code === SIGN_IN_REQUIRED_CODE
          ? currentPracticeSignInHref()
          : undefined,
    };
  }
  return {
    message:
      "The tutor could not be reached. Please check your connection and try again.",
  };
}

export type ParsedAnswerPreview = {
  /** KaTeX source for the interpretation: "\frac{1}{4} = 0.25". */
  latex: string;
  /** Plain words for the same thing: "0.25", "about 0.3333". */
  text: string;
  value: number;
};

const PLAIN_NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)`;
const NUMBER_PATTERN = new RegExp(`^(${PLAIN_NUMBER})$`);
const PERCENT_PATTERN = new RegExp(`^(${PLAIN_NUMBER})\\s*%$`);
const FRACTION_PATTERN = new RegExp(
  `^(${PLAIN_NUMBER})\\s*\\/\\s*(${PLAIN_NUMBER})$`,
);

function formatPreviewValue(value: number) {
  const scaled = value * 1_000_000;
  const exact = Math.abs(scaled - Math.round(scaled)) < 1e-6;
  return exact
    ? { approximate: false, text: String(Number(value.toFixed(6))) }
    : { approximate: true, text: String(Number(value.toFixed(4))) };
}

function latexNumber(raw: string) {
  return raw.replace(/^\+/, "");
}

/**
 * How the answer field reads what the student typed, shown under the field
 * while they type: "1/4" and "25%" both read as 0.25. Only a plain number, an
 * a/b fraction or a percentage is interpreted; anything else (an expression, a
 * word, half-typed input) returns null, so the preview never shows an error.
 * Pure and client-only: nothing is sent and nothing is graded. Returns null
 * when the reading would only repeat what was typed ("0.25" → 0.25).
 */
export function parsedAnswerPreview(raw: string): ParsedAnswerPreview | null {
  const input = raw.trim();
  if (input.length === 0 || input.length > 40) {
    return null;
  }

  let value: number;
  let source: string;

  const percent = PERCENT_PATTERN.exec(input);
  const fraction = FRACTION_PATTERN.exec(input);
  const number = NUMBER_PATTERN.exec(input);

  if (percent) {
    value = Number(percent[1]) / 100;
    source = `${latexNumber(percent[1])}\\%`;
  } else if (fraction) {
    const denominator = Number(fraction[2]);
    if (denominator === 0) {
      return null;
    }
    value = Number(fraction[1]) / denominator;
    source = `\\frac{${latexNumber(fraction[1])}}{${latexNumber(fraction[2])}}`;
  } else if (number) {
    value = Number(number[1]);
    source = "";
  } else {
    return null;
  }

  if (!Number.isFinite(value)) {
    return null;
  }

  const formatted = formatPreviewValue(value);
  if (!formatted.approximate && formatted.text === input) {
    return null;
  }

  const relation = formatted.approximate ? "\\approx" : "=";
  return {
    latex: source ? `${source} ${relation} ${formatted.text}` : formatted.text,
    text: formatted.approximate ? `about ${formatted.text}` : formatted.text,
    value,
  };
}
