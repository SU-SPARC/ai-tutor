import { NextResponse } from "next/server";

import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";
import { authorizeStudentResourceApi } from "@/lib/auth/authorization";
import {
  QuestionFeedbackNotFoundError,
  QuestionFeedbackRateLimitError,
  QuestionFeedbackValidationError,
  submitQuestionFeedback,
} from "@/lib/data/question-feedback-repository";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import {
  QUESTION_FEEDBACK_CATEGORIES,
  type QuestionFeedbackCategory,
} from "@/lib/types";

type FeedbackRouteContext = {
  params: Promise<{ sessionId: string }>;
};

type FeedbackBody = {
  category?: unknown;
  details?: unknown;
  idempotencyKey?: unknown;
};

export async function POST(request: Request, context: FeedbackRouteContext) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 4_096) {
    return NextResponse.json(
      { error: "Feedback requests must be smaller than 4096 bytes." },
      { status: 413 },
    );
  }

  const rateLimit = checkRateLimit(
    `question-feedback:${getClientIp(request)}`,
    { max: 10, windowMs: 60 * 60 * 1_000 },
  );
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many reports were submitted. Please try again later." },
      {
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        status: 429,
      },
    );
  }

  let body: FeedbackBody;
  try {
    body = (await request.json()) as FeedbackBody;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const category = categoryValue(body.category);
  const idempotencyKey = stringValue(
    body.idempotencyKey ?? request.headers.get("Idempotency-Key"),
  );
  if (!category || !idempotencyKey) {
    return NextResponse.json(
      { error: "category and idempotencyKey are required." },
      { status: 400 },
    );
  }

  const access = await authorizeStudentResourceApi();
  if (!access.ok) return access.response;
  const { sessionId } = await context.params;

  try {
    const receipt = await submitQuestionFeedback(access.authorization, {
      category,
      details: optionalString(body.details),
      idempotencyKey,
      sessionId,
    });
    return NextResponse.json(
      { receipt },
      {
        headers: { "Cache-Control": "private, no-store" },
        status: 201,
      },
    );
  } catch (cause) {
    if (cause instanceof QuestionFeedbackValidationError) {
      return NextResponse.json({ error: cause.message }, { status: 400 });
    }
    if (cause instanceof QuestionFeedbackNotFoundError) {
      return NextResponse.json(
        { error: "Tutor session was not found." },
        { status: 404 },
      );
    }
    if (cause instanceof QuestionFeedbackRateLimitError) {
      return NextResponse.json(
        { error: cause.message },
        {
          headers: { "Retry-After": String(cause.retryAfterSeconds) },
          status: 429,
        },
      );
    }
    return dataServiceUnavailableResponse();
  }
}

function categoryValue(value: unknown): QuestionFeedbackCategory | undefined {
  return typeof value === "string" &&
    QUESTION_FEEDBACK_CATEGORIES.includes(value as QuestionFeedbackCategory)
    ? (value as QuestionFeedbackCategory)
    : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
