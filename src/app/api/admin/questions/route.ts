import { NextResponse } from "next/server"

import {
  getAdminQuestionDashboard,
  updateAdminQuestionsStrict,
} from "@/lib/data/data-store"
import type {
  AdminQuestionFilters,
  AdminQuestionUpdate,
} from "@/lib/data/repository"
import { isValidSourceType } from "@/lib/api/question-serialization"
import { authorizeProfessorReview } from "@/lib/tutor/professor-auth"
import { isValidReviewStatus } from "@/lib/tutor/professor-admin"
import type { ReviewStatus, SourceType } from "@/lib/types"

const ADMIN_QUESTION_ACTIONS = [
  "approve",
  "mark_needs_review",
  "reject",
  "request_regeneration",
] satisfies AdminQuestionUpdate["action"][]

export async function GET(request: Request) {
  const parsed = parseFilters(new URL(request.url).searchParams)

  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const dashboard = await getAdminQuestionDashboard(parsed.filters)

  return NextResponse.json({ dashboard })
}

export async function PATCH(request: Request) {
  const auth = authorizeProfessorReview(request.headers)

  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status })
  }

  const parsed = await parseMutation(request)

  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status })
  }

  try {
    const questions = await updateAdminQuestionsStrict(parsed.update)

    if (questions.length === 0) {
      return NextResponse.json(
        { error: "Question was not found or is not editable." },
        { status: 404 },
      )
    }

    return NextResponse.json({ questions })
  } catch {
    return NextResponse.json(
      {
        error:
          "Admin question mutations require a configured database. Demo data is read-only.",
      },
      { status: 503 },
    )
  }
}

function parseFilters(
  searchParams: URLSearchParams,
): { filters: AdminQuestionFilters } | { error: string } {
  const status = searchParams.get("status")?.trim() || undefined
  const topicId =
    searchParams.get("topicId")?.trim() ||
    searchParams.get("topic")?.trim() ||
    undefined
  const sourceType = searchParams.get("sourceType")?.trim() || undefined
  const generatedOnly =
    searchParams.get("generatedOnly") === "true" ||
    searchParams.get("generatedOnly") === "1"

  if (status && !isValidReviewStatus(status)) {
    return { error: `Invalid review status: ${status}` }
  }

  if (sourceType && !isValidSourceType(sourceType)) {
    return { error: `Invalid sourceType: ${sourceType}` }
  }

  return {
    filters: {
      generatedOnly,
      sourceType: sourceType as SourceType | undefined,
      status: status as ReviewStatus | undefined,
      topicId,
    },
  }
}

async function parseMutation(
  request: Request,
): Promise<
  | { update: AdminQuestionUpdate }
  | { error: string; status: 400 | 413 }
> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0)
  if (declaredLength > 16_384) {
    return {
      error: "Admin question mutation requests must be smaller than 16KB.",
      status: 413,
    }
  }

  let body: Record<string, unknown>

  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return { error: "Request body must be valid JSON.", status: 400 }
  }

  const questionIds = parseQuestionIds(body)
  const action =
    typeof body.action === "string" &&
    (ADMIN_QUESTION_ACTIONS as readonly string[]).includes(body.action)
      ? (body.action as AdminQuestionUpdate["action"])
      : undefined

  if (questionIds.length === 0) {
    return { error: "questionIds or questionId is required.", status: 400 }
  }

  if (!action) {
    return { error: "A supported admin question action is required.", status: 400 }
  }

  return {
    update: {
      action,
      questionIds,
      reviewedBy: "admin",
    },
  }
}

function parseQuestionIds(body: Record<string, unknown>) {
  if (Array.isArray(body.questionIds)) {
    return body.questionIds.filter(
      (questionId): questionId is string =>
        typeof questionId === "string" && questionId.trim().length > 0,
    )
  }

  return typeof body.questionId === "string" && body.questionId.trim()
    ? [body.questionId.trim()]
    : []
}
