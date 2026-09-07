import { NextResponse } from "next/server";

import {
  dataServiceUnavailableResponse,
  safeApiErrorResponse,
  tutorSessionUnavailableResponse,
} from "@/lib/api/service-unavailable";
import { toTutorResponseDto } from "@/lib/api/tutor-response-dto";
import { getServableTutorSessionQuestion } from "@/lib/api/tutor-session-dto";
import {
  authorizeStudentResourceApi,
  ownerFromAuthorization,
} from "@/lib/auth/authorization";
import {
  AiGenerationInProgressError,
  releaseTutorAiReservation,
  type TutorAiAccounting,
} from "@/lib/ai/usage-controls";
import {
  getTutorSession,
  persistTutorSessionTransition,
} from "@/lib/data/tutor-session-repository";
import { getServerEnv } from "@/lib/env/server";
import {
  logPilotOperationalEvent,
  pilotRequestId,
} from "@/lib/observability/pilot-operations";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { isTutorSessionIdempotencyKey } from "@/lib/tutor/session-persistence";
import { createTutorResponseFromState } from "@/lib/tutor/tutor-engine";
import type {
  PracticeQuestion,
  TutorRequest,
  TutorResponse,
  TutorSessionAttempt,
  TutorSessionEngineState,
  TutorSessionRecord,
} from "@/lib/types";

const MAX_CONCURRENCY_RETRIES = 3;
const MAX_TUTOR_REQUEST_BYTES = 8_192;
const TUTOR_RESPOND_ROUTE = "/api/tutor/respond";

export async function POST(request: Request) {
  let pendingAiAccounting: TutorAiAccounting | undefined;
  const requestId = pilotRequestId(request);
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_TUTOR_REQUEST_BYTES) {
    return malformedTutorResponse(
      requestId,
      "TUTOR_REQUEST_TOO_LARGE",
      "Tutor requests must be smaller than 8192 bytes.",
      413,
    );
  }

  const env = getServerEnv();
  const rateLimit = checkRateLimit(getClientIp(request), {
    max: env.RATE_LIMIT_MAX_REQUESTS,
    windowMs: env.RATE_LIMIT_WINDOW_SECONDS * 1_000,
  });

  if (!rateLimit.allowed) {
    return tutorRateLimitResponse(requestId, rateLimit.retryAfterSeconds);
  }

  const parsedBody = await readJsonBodyWithLimit(
    request,
    MAX_TUTOR_REQUEST_BYTES,
  );
  if (parsedBody.outcome !== "parsed") {
    return parsedBody.outcome === "too_large"
      ? malformedTutorResponse(
          requestId,
          "TUTOR_REQUEST_TOO_LARGE",
          "Tutor requests must be smaller than 8192 bytes.",
          413,
        )
      : malformedTutorResponse(
          requestId,
          parsedBody.outcome === "interrupted"
            ? "TUTOR_REQUEST_INTERRUPTED"
            : "MALFORMED_TUTOR_REQUEST",
          parsedBody.outcome === "interrupted"
            ? "The tutor request was interrupted before it was received. Please try again."
            : "Request body must be valid JSON.",
          400,
        );
  }
  const body = parsedBody.body;

  if (
    !body.mode ||
    !["check", "hint", "solution", "full_solution"].includes(body.mode)
  ) {
    return malformedTutorResponse(
      requestId,
      "MALFORMED_TUTOR_REQUEST",
      "mode must be one of: check, hint, solution, full_solution.",
      400,
    );
  }
  if (!body.sessionId || typeof body.sessionId !== "string") {
    return malformedTutorResponse(
      requestId,
      "MALFORMED_TUTOR_REQUEST",
      "sessionId is required for tutor responses.",
      400,
    );
  }
  if (
    body.allowLlmFallback !== undefined &&
    typeof body.allowLlmFallback !== "boolean"
  ) {
    return malformedTutorResponse(
      requestId,
      "MALFORMED_TUTOR_REQUEST",
      "allowLlmFallback must be a boolean.",
      400,
    );
  }
  if (
    body.allowLlmFallback &&
    (typeof body.answer !== "string" || body.answer.trim().length > 500)
  ) {
    return malformedTutorResponse(
      requestId,
      "MALFORMED_TUTOR_REQUEST",
      "AI help messages must be 500 characters or fewer.",
      400,
    );
  }
  const access = await authorizeStudentResourceApi({
    request,
    requestId,
    route: TUTOR_RESPOND_ROUTE,
  });
  if (!access.ok) {
    return access.response;
  }
  const owner = ownerFromAuthorization(access.authorization);
  const ownerRateLimit = checkRateLimit(
    owner.kind === "user"
      ? `student:user:${owner.userId}`
      : `student:anonymous:${owner.anonymousId}`,
    {
      max: env.RATE_LIMIT_MAX_REQUESTS,
      windowMs: env.RATE_LIMIT_WINDOW_SECONDS * 1_000,
    },
  );
  if (!ownerRateLimit.allowed) {
    return tutorRateLimitResponse(requestId, ownerRateLimit.retryAfterSeconds);
  }

  try {
    let session = await getTutorSession(access.authorization, body.sessionId);
    const currentlyApprovedQuestion = session
      ? await getServableTutorSessionQuestion(session)
      : undefined;

    if (!session || !currentlyApprovedQuestion) {
      return sessionNotFoundResponse(requestId);
    }
    if (!isTutorSessionIdempotencyKey(body.eventId)) {
      return malformedTutorResponse(
        requestId,
        "MALFORMED_TUTOR_REQUEST",
        "eventId must be a 1-128 character idempotency key.",
        400,
      );
    }
    if (body.questionId && body.questionId !== session.questionId) {
      return malformedTutorResponse(
        requestId,
        "MALFORMED_TUTOR_REQUEST",
        "The tutor response question must match the active session.",
        400,
      );
    }

    const question = session.questionVersion ?? currentlyApprovedQuestion;
    const answer = typeof body.answer === "string" ? body.answer : "";

    for (let retry = 0; retry < MAX_CONCURRENCY_RETRIES; retry += 1) {
      const existing = session.attempts.find(
        (attempt) => attempt.idempotencyKey === body.eventId,
      );
      if (existing?.verdict) {
        return tutorSuccessResponse(
          toTutorResponseDto(recoveredResponse(session, existing, question)),
          requestId,
        );
      }
      if (session.status === "completed") {
        return safeApiErrorResponse({
          code: "TUTOR_SESSION_COMPLETE",
          error: "This tutor session is already complete.",
          requestId,
          route: TUTOR_RESPOND_ROUTE,
          status: 409,
          subsystem: "tutor-session",
        });
      }

      const state = session.engineState ?? initialStateFor(session);
      const transition = await createTutorResponseFromState(
        {
          allowLlmFallback: body.allowLlmFallback ?? false,
          answer,
          mode: body.mode,
          questionId: question.id,
          sessionId: session.id,
          topicId: question.topicId,
        },
        state,
        question,
        body.allowLlmFallback
          ? {
              eventId: body.eventId,
              expectedRevision: session.revision ?? 0,
              mode: body.mode,
              owner,
              questionId: question.id,
              questionVersionId: session.questionVersionId!,
              sessionId: session.id,
              topicId: question.topicId,
            }
          : undefined,
      );
      pendingAiAccounting = transition.aiAccounting;
      const persisted = await persistTutorSessionTransition(
        access.authorization,
        {
          expectedRevision: session.revision ?? 0,
          idempotencyKey: body.eventId,
          aiAccounting: transition.aiAccounting,
          mode: body.mode,
          response: transition.response,
          sessionId: session.id,
          state: transition.state,
          submittedAnswer: answer,
        },
      );

      if (persisted.outcome === "applied") {
        pendingAiAccounting = undefined;
        return tutorSuccessResponse(
          toTutorResponseDto(transition.response),
          requestId,
        );
      }
      if (persisted.outcome === "idempotent") {
        await releaseReservationSafely(transition.aiAccounting, requestId);
        pendingAiAccounting = undefined;
        const saved = persisted.session.attempts.find(
          (attempt) => attempt.idempotencyKey === body.eventId,
        );
        return saved
          ? tutorSuccessResponse(
              toTutorResponseDto(
                recoveredResponse(persisted.session, saved, question),
              ),
              requestId,
            )
          : dataServiceUnavailableResponse({
              requestId,
              route: TUTOR_RESPOND_ROUTE,
              subsystem: "tutor-session",
            });
      }
      if (persisted.outcome === "not_found") {
        await releaseReservationSafely(transition.aiAccounting, requestId);
        pendingAiAccounting = undefined;
        return sessionNotFoundResponse(requestId);
      }

      if (transition.aiAccounting?.reservationId) {
        await releaseReservationSafely(transition.aiAccounting, requestId);
        pendingAiAccounting = undefined;
        return staleSessionResponse(requestId);
      }

      session = persisted.session;
    }

    return staleSessionResponse(requestId);
  } catch (error) {
    await releaseReservationSafely(pendingAiAccounting, requestId);
    if (error instanceof AiGenerationInProgressError) {
      return safeApiErrorResponse({
        code: "TUTOR_AI_IN_PROGRESS",
        error: error.message,
        requestId,
        retryAfterSeconds: 1,
        route: TUTOR_RESPOND_ROUTE,
        status: 409,
        subsystem: "tutor-session",
      });
    }
    return dataServiceUnavailableResponse({
      cause: error,
      request,
      requestId,
      route: TUTOR_RESPOND_ROUTE,
    });
  }
}

function malformedTutorResponse(
  requestId: string,
  code: string,
  error: string,
  status: 400 | 413,
) {
  return safeApiErrorResponse({
    code,
    error,
    event: "malformed_request",
    requestId,
    route: TUTOR_RESPOND_ROUTE,
    status,
    subsystem: "tutor-session",
  });
}

function tutorRateLimitResponse(requestId: string, retryAfterSeconds = 1) {
  return safeApiErrorResponse({
    code: "TUTOR_RATE_LIMITED",
    error: "Too many tutor requests. Please wait a moment and try again.",
    event: "rate_limit_reached",
    requestId,
    retryAfterSeconds,
    route: TUTOR_RESPOND_ROUTE,
    status: 429,
    subsystem: "tutor-session",
  });
}

function staleSessionResponse(requestId: string) {
  return safeApiErrorResponse({
    code: "TUTOR_SESSION_STALE",
    error:
      "Your tutor session changed in another tab. Refreshing the saved session is safe; then try again.",
    event: "session_stale",
    requestId,
    retryAfterSeconds: 1,
    route: TUTOR_RESPOND_ROUTE,
    status: 409,
    subsystem: "tutor-session",
  });
}

function tutorSuccessResponse(body: unknown, requestId: string) {
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "private, no-store",
      "X-Request-Id": requestId,
    },
  });
}

async function readJsonBodyWithLimit(
  request: Request,
  maximumBytes: number,
): Promise<
  | { body: Partial<TutorRequest>; outcome: "parsed" }
  | { outcome: "interrupted" | "invalid" | "too_large" }
> {
  const reader = request.body?.getReader();
  if (!reader) {
    return { outcome: "invalid" };
  }

  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      receivedBytes += value.byteLength;
      if (receivedBytes > maximumBytes) {
        try {
          await reader.cancel();
        } catch {
          // The bounded rejection remains valid if stream cleanup fails.
        }
        return { outcome: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { outcome: "interrupted" };
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const body = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { outcome: "invalid" };
    }
    return { body: body as Partial<TutorRequest>, outcome: "parsed" };
  } catch {
    return { outcome: "invalid" };
  }
}

async function releaseReservationSafely(
  accounting: TutorAiAccounting | undefined,
  requestId: string,
) {
  try {
    await releaseTutorAiReservation(accounting);
  } catch (cause) {
    // Reservations expire automatically. Cleanup must not expose database or
    // provider details or replace the safe tutor response with a new failure.
    logPilotOperationalEvent({
      cause,
      event: "data_service_unavailable",
      requestId,
      route: TUTOR_RESPOND_ROUTE,
      status: 503,
      subsystem: "tutor-session",
    });
  }
}

function sessionNotFoundResponse(requestId: string) {
  return tutorSessionUnavailableResponse({
    requestId,
    route: TUTOR_RESPOND_ROUTE,
  });
}

function initialStateFor(session: TutorSessionRecord): TutorSessionEngineState {
  return {
    attemptCount: session.attemptCount ?? 0,
    hintsRevealed: session.revealedHints,
    lastMisconceptionIds: [],
    llmUsed: session.llmUsed ?? false,
    questionKey: session.questionId,
    retrievalUsed: session.retrievalUsed ?? false,
    sessionId: session.id,
    solved: session.solved ?? false,
    state: session.currentState ?? "working",
    stepsRevealed: session.revealedSteps,
    wrongAttemptCount: session.wrongAttemptCount ?? 0,
  };
}

function recoveredResponse(
  session: TutorSessionRecord,
  attempt: TutorSessionAttempt,
  question: PracticeQuestion,
): TutorResponse {
  const verdict = attempt.verdict ?? "guidance";
  const mode = attempt.mode ?? "check";
  const misconceptions = attempt.misconceptionFeedback ?? [];
  const message =
    verdict === "correct"
      ? question.answer.explanation
      : verdict === "incorrect"
        ? misconceptions.length > 0
          ? "Not quite. I found a likely misconception to check first."
          : "Not quite."
        : verdict === "blocked"
          ? "AI assistance is unavailable or its allowance has been reached for now. Your saved progress is unchanged."
          : mode === "hint"
            ? "Here is the next approved hint."
            : mode === "solution" || mode === "full_solution"
              ? question.answer.explanation
              : "Your saved tutor progress is current.";

  return {
    hints:
      mode === "hint" ? question.hints.slice(0, session.revealedHints) : [],
    message,
    misconceptions,
    progress: {
      attemptCount: session.attemptCount ?? session.attempts.length,
      hintsRevealed: session.revealedHints,
      llmUsed: session.llmUsed ?? false,
      retrievalUsed: session.retrievalUsed ?? false,
      solved: session.solved ?? false,
      state: session.currentState ?? attempt.state ?? "working",
      stepsRevealed: session.revealedSteps,
      wrongAttemptCount: session.wrongAttemptCount ?? 0,
    },
    responseLabel: attempt.responseLabel,
    retrievedContext: [],
    source: attempt.source ?? "rule",
    steps:
      mode === "solution" || mode === "full_solution" || verdict === "correct"
        ? question.solutionSteps.slice(0, session.revealedSteps)
        : [],
    usage: {
      contextUsed: attempt.contextUsed ?? false,
      estimatedTokens: attempt.estimatedTokens ?? 0,
      fallbackUsed: attempt.fallbackUsed ?? false,
    },
    verdict,
  };
}
