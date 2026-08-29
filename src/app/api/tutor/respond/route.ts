import { NextResponse } from "next/server";

import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";
import { toTutorResponseDto } from "@/lib/api/tutor-response-dto";
import {
  authorizeStudentResourceApi,
  ownerFromAuthorization,
} from "@/lib/auth/authorization";
import {
  AiGenerationInProgressError,
  releaseTutorAiReservation,
  type TutorAiAccounting,
} from "@/lib/ai/usage-controls";
import { getApprovedQuestionById } from "@/lib/data/data-store";
import {
  getTutorSession,
  persistTutorSessionTransition,
} from "@/lib/data/tutor-session-repository";
import { getServerEnv } from "@/lib/env/server";
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

export async function POST(request: Request) {
  let pendingAiAccounting: TutorAiAccounting | undefined;
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_TUTOR_REQUEST_BYTES) {
    return NextResponse.json(
      { error: "Tutor requests must be smaller than 8192 bytes." },
      { status: 413 },
    );
  }

  const env = getServerEnv();
  const rateLimit = checkRateLimit(getClientIp(request), {
    max: env.RATE_LIMIT_MAX_REQUESTS,
    windowMs: env.RATE_LIMIT_WINDOW_SECONDS * 1_000,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      {
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        status: 429,
      },
    );
  }

  const parsedBody = await readJsonBodyWithLimit(
    request,
    MAX_TUTOR_REQUEST_BYTES,
  );
  if (parsedBody.outcome !== "parsed") {
    return parsedBody.outcome === "too_large"
      ? NextResponse.json(
          { error: "Tutor requests must be smaller than 8192 bytes." },
          { status: 413 },
        )
      : NextResponse.json(
          { error: "Request body must be valid JSON." },
          { status: 400 },
        );
  }
  const body = parsedBody.body;

  if (
    !body.mode ||
    !["check", "hint", "solution", "full_solution"].includes(body.mode)
  ) {
    return NextResponse.json(
      { error: "mode must be one of: check, hint, solution, full_solution." },
      { status: 400 },
    );
  }
  if (!body.sessionId || typeof body.sessionId !== "string") {
    return NextResponse.json(
      { error: "sessionId is required for tutor responses." },
      { status: 400 },
    );
  }
  if (
    body.allowLlmFallback !== undefined &&
    typeof body.allowLlmFallback !== "boolean"
  ) {
    return NextResponse.json(
      { error: "allowLlmFallback must be a boolean." },
      { status: 400 },
    );
  }
  if (
    body.allowLlmFallback &&
    (typeof body.answer !== "string" || body.answer.trim().length > 500)
  ) {
    return NextResponse.json(
      { error: "AI help messages must be 500 characters or fewer." },
      { status: 400 },
    );
  }
  const access = await authorizeStudentResourceApi();
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
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      {
        headers: { "Retry-After": String(ownerRateLimit.retryAfterSeconds) },
        status: 429,
      },
    );
  }

  try {
    let session = await getTutorSession(access.authorization, body.sessionId);
    const currentlyApprovedQuestion = session
      ? await getApprovedQuestionById(session.questionId)
      : undefined;

    if (!session || !currentlyApprovedQuestion) {
      return sessionNotFoundResponse();
    }
    if (!isTutorSessionIdempotencyKey(body.eventId)) {
      return NextResponse.json(
        { error: "eventId must be a 1-128 character idempotency key." },
        { status: 400 },
      );
    }
    if (body.questionId && body.questionId !== session.questionId) {
      return NextResponse.json(
        { error: "The tutor response question must match the active session." },
        { status: 400 },
      );
    }

    const question = session.questionVersion ?? currentlyApprovedQuestion;
    const answer = typeof body.answer === "string" ? body.answer : "";

    for (let retry = 0; retry < MAX_CONCURRENCY_RETRIES; retry += 1) {
      const existing = session.attempts.find(
        (attempt) => attempt.idempotencyKey === body.eventId,
      );
      if (existing?.verdict) {
        return NextResponse.json(
          toTutorResponseDto(recoveredResponse(session, existing, question)),
        );
      }
      if (session.status === "completed") {
        return NextResponse.json(
          { error: "This tutor session is already complete." },
          { status: 409 },
        );
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
        return NextResponse.json(toTutorResponseDto(transition.response));
      }
      if (persisted.outcome === "idempotent") {
        await releaseReservationSafely(transition.aiAccounting);
        pendingAiAccounting = undefined;
        const saved = persisted.session.attempts.find(
          (attempt) => attempt.idempotencyKey === body.eventId,
        );
        return saved
          ? NextResponse.json(
              toTutorResponseDto(
                recoveredResponse(persisted.session, saved, question),
              ),
            )
          : dataServiceUnavailableResponse();
      }
      if (persisted.outcome === "not_found") {
        await releaseReservationSafely(transition.aiAccounting);
        pendingAiAccounting = undefined;
        return sessionNotFoundResponse();
      }

      if (transition.aiAccounting?.reservationId) {
        await releaseReservationSafely(transition.aiAccounting);
        pendingAiAccounting = undefined;
        return NextResponse.json(
          {
            error:
              "Tutor progress changed while AI help was being prepared. Please retry.",
          },
          { headers: { "Retry-After": "1" }, status: 409 },
        );
      }

      session = persisted.session;
    }

    return NextResponse.json(
      { error: "Tutor progress changed in another request. Please retry." },
      { status: 409 },
    );
  } catch (error) {
    await releaseReservationSafely(pendingAiAccounting);
    if (error instanceof AiGenerationInProgressError) {
      return NextResponse.json(
        { error: error.message },
        { headers: { "Retry-After": "1" }, status: 409 },
      );
    }
    return dataServiceUnavailableResponse();
  }
}

async function readJsonBodyWithLimit(
  request: Request,
  maximumBytes: number,
): Promise<
  | { body: Partial<TutorRequest>; outcome: "parsed" }
  | { outcome: "invalid" | "too_large" }
> {
  const reader = request.body?.getReader();
  if (!reader) {
    return { outcome: "invalid" };
  }

  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    receivedBytes += value.byteLength;
    if (receivedBytes > maximumBytes) {
      await reader.cancel();
      return { outcome: "too_large" };
    }
    chunks.push(value);
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

async function releaseReservationSafely(accounting?: TutorAiAccounting) {
  try {
    await releaseTutorAiReservation(accounting);
  } catch {
    // Reservations expire automatically. Cleanup must not expose database or
    // provider details or replace the safe tutor response with a new failure.
  }
}

function sessionNotFoundResponse() {
  return NextResponse.json(
    { error: "Tutor session was not found." },
    { status: 404 },
  );
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
