import { NextResponse } from "next/server";

import {
  createQuestionLifecycle,
  getAdminQuestionDashboard,
  listQuestionLifecycles,
  updateAdminQuestionsStrict,
} from "@/lib/data/data-store";
import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";
import type {
  AdminQuestionFilters,
  AdminQuestionUpdate,
} from "@/lib/data/repository";
import { isValidSourceType } from "@/lib/api/question-serialization";
import { authorizeApi, requireProfessorReview } from "@/lib/auth/authorization";
import { isValidReviewStatus } from "@/lib/tutor/professor-tools";
import type { ReviewStatus, SourceType } from "@/lib/types";
import {
  enumValue,
  isRecord,
  lifecycleApiErrorResponse,
  parseQuestionVersionContent,
  QUESTION_CREATION_METHODS,
  QUESTION_VERSION_STATES,
} from "@/lib/api/question-lifecycle";

const ADMIN_QUESTION_ACTIONS = [
  "approve",
  "mark_needs_review",
  "reject",
  "request_regeneration",
] satisfies AdminQuestionUpdate["action"][];

export async function GET(request: Request) {
  const access = await authorizeApi(requireProfessorReview);
  if (!access.ok) {
    return access.response;
  }

  const searchParams = new URL(request.url).searchParams;

  if (searchParams.get("view") === "lifecycle") {
    const stateValue = searchParams.get("state") ?? undefined;
    const state = stateValue
      ? enumValue(stateValue, QUESTION_VERSION_STATES)
      : undefined;
    if (stateValue && !state) {
      return NextResponse.json(
        { error: `Invalid lifecycle state: ${stateValue}` },
        { status: 400 },
      );
    }
    try {
      const questions = await listQuestionLifecycles(access.authorization, {
        recordState:
          searchParams.get("recordState") === "archived"
            ? "archived"
            : searchParams.get("recordState") === "active"
              ? "active"
              : undefined,
        state,
        topicId: searchParams.get("topicId")?.trim() || undefined,
      });
      return NextResponse.json({ questions });
    } catch (error) {
      return lifecycleApiErrorResponse(error);
    }
  }

  const parsed = parseFilters(searchParams);

  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const dashboard = await getAdminQuestionDashboard(
      access.authorization,
      parsed.filters,
    );
    return NextResponse.json({ dashboard });
  } catch {
    return dataServiceUnavailableResponse();
  }
}

export async function POST(request: Request) {
  const access = await authorizeApi(requireProfessorReview);
  if (!access.ok) {
    return access.response;
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 65_536) {
    return NextResponse.json(
      { error: "Question creation requests must be smaller than 64KB." },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }
  if (!isRecord(body)) {
    return NextResponse.json(
      { error: "Request body must be a JSON object." },
      { status: 400 },
    );
  }

  const content = parseQuestionVersionContent(body.content);
  const creationMethod = enumValue(
    body.creationMethod,
    QUESTION_CREATION_METHODS,
  );
  if (!content || !creationMethod) {
    return NextResponse.json(
      {
        error:
          "A valid public-safe question content object and creationMethod are required.",
      },
      { status: 422 },
    );
  }

  try {
    const question = await createQuestionLifecycle(access.authorization, {
      content,
      creationMethod,
      submit: body.submit === true,
    });
    return NextResponse.json({ question }, { status: 201 });
  } catch (error) {
    return lifecycleApiErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const access = await authorizeApi(requireProfessorReview);

  if (!access.ok) {
    return access.response;
  }

  const parsed = await parseMutation(request);

  if ("error" in parsed) {
    return NextResponse.json(
      { error: parsed.error },
      { status: parsed.status },
    );
  }

  try {
    const questions = await updateAdminQuestionsStrict(
      access.authorization,
      parsed.update,
    );

    if (questions.length === 0) {
      return NextResponse.json(
        { error: "Question was not found or is not editable." },
        { status: 404 },
      );
    }

    return NextResponse.json({ questions });
  } catch {
    return NextResponse.json(
      {
        error:
          "Professor question mutations require a configured database. Demo data is read-only.",
      },
      { status: 503 },
    );
  }
}

function parseFilters(
  searchParams: URLSearchParams,
): { filters: AdminQuestionFilters } | { error: string } {
  const status = searchParams.get("status")?.trim() || undefined;
  const topicId =
    searchParams.get("topicId")?.trim() ||
    searchParams.get("topic")?.trim() ||
    undefined;
  const sourceType = searchParams.get("sourceType")?.trim() || undefined;
  const generatedOnly =
    searchParams.get("generatedOnly") === "true" ||
    searchParams.get("generatedOnly") === "1";

  if (status && !isValidReviewStatus(status)) {
    return { error: `Invalid review status: ${status}` };
  }

  if (sourceType && !isValidSourceType(sourceType)) {
    return { error: `Invalid sourceType: ${sourceType}` };
  }

  return {
    filters: {
      generatedOnly,
      sourceType: sourceType as SourceType | undefined,
      status: status as ReviewStatus | undefined,
      topicId,
    },
  };
}

async function parseMutation(
  request: Request,
): Promise<
  { update: AdminQuestionUpdate } | { error: string; status: 400 | 413 }
> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 16_384) {
    return {
      error: "Professor question mutation requests must be smaller than 16KB.",
      status: 413,
    };
  }

  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return { error: "Request body must be valid JSON.", status: 400 };
  }

  const questionIds = parseQuestionIds(body);
  const action =
    typeof body.action === "string" &&
    (ADMIN_QUESTION_ACTIONS as readonly string[]).includes(body.action)
      ? (body.action as AdminQuestionUpdate["action"])
      : undefined;

  if (questionIds.length === 0) {
    return { error: "questionIds or questionId is required.", status: 400 };
  }

  if (!action) {
    return {
      error: "A supported professor question action is required.",
      status: 400,
    };
  }

  return {
    update: {
      action,
      questionIds,
    },
  };
}

function parseQuestionIds(body: Record<string, unknown>) {
  if (Array.isArray(body.questionIds)) {
    return body.questionIds.filter(
      (questionId): questionId is string =>
        typeof questionId === "string" && questionId.trim().length > 0,
    );
  }

  return typeof body.questionId === "string" && body.questionId.trim()
    ? [body.questionId.trim()]
    : [];
}
