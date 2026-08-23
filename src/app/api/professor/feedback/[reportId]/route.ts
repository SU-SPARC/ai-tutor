import { NextResponse } from "next/server";

import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";
import { authorizeApi, requireProfessorReview } from "@/lib/auth/authorization";
import {
  QuestionFeedbackNotFoundError,
  QuestionFeedbackValidationError,
  reviewQuestionFeedback,
} from "@/lib/data/question-feedback-repository";
import {
  QUESTION_FEEDBACK_STATUSES,
  type QuestionFeedbackStatus,
} from "@/lib/types";

type FeedbackReviewRouteContext = {
  params: Promise<{ reportId: string }>;
};

type FeedbackReviewBody = {
  resolutionNotes?: unknown;
  status?: unknown;
};

export async function PATCH(
  request: Request,
  context: FeedbackReviewRouteContext,
) {
  const access = await authorizeApi(requireProfessorReview);
  if (!access.ok) return access.response;

  let body: FeedbackReviewBody;
  try {
    body = (await request.json()) as FeedbackReviewBody;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const status = statusValue(body.status);
  if (!status) {
    return NextResponse.json(
      { error: "A valid feedback status is required." },
      { status: 400 },
    );
  }
  const { reportId } = await context.params;

  try {
    const report = await reviewQuestionFeedback(access.authorization, {
      reportId,
      resolutionNotes: optionalString(body.resolutionNotes),
      status,
    });
    return NextResponse.json(
      { report },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (cause) {
    if (cause instanceof QuestionFeedbackValidationError) {
      return NextResponse.json({ error: cause.message }, { status: 400 });
    }
    if (cause instanceof QuestionFeedbackNotFoundError) {
      return NextResponse.json(
        { error: "Feedback report was not found." },
        { status: 404 },
      );
    }
    return dataServiceUnavailableResponse();
  }
}

function statusValue(value: unknown): QuestionFeedbackStatus | undefined {
  return typeof value === "string" &&
    QUESTION_FEEDBACK_STATUSES.includes(value as QuestionFeedbackStatus)
    ? (value as QuestionFeedbackStatus)
    : undefined;
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
