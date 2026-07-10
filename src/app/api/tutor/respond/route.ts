import { NextResponse } from "next/server"

import {
  getTutorSession,
  recordTutorSessionAttemptOutcome,
} from "@/lib/data/tutor-session-repository"
import { createTutorResponse } from "@/lib/tutor/tutor-engine"
import type { TutorRequest } from "@/lib/types"

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0)
  if (declaredLength > 8_192) {
    return NextResponse.json(
      { error: "Tutor requests must be smaller than 8192 bytes." },
      { status: 413 },
    )
  }

  let body: Partial<TutorRequest>

  try {
    body = (await request.json()) as Partial<TutorRequest>
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    )
  }

  if (!body.mode || !["check", "hint", "solution"].includes(body.mode)) {
    return NextResponse.json(
      { error: "mode must be one of: check, hint, solution." },
      { status: 400 },
    )
  }

  if (!body.sessionId || typeof body.sessionId !== "string") {
    return NextResponse.json(
      { error: "sessionId is required for tutor responses." },
      { status: 400 },
    )
  }

  const session = await getTutorSession(body.sessionId)
  if (!session) {
    return NextResponse.json(
      { error: "Tutor session was not found." },
      { status: 404 },
    )
  }

  if (body.questionId && body.questionId !== session.questionId) {
    return NextResponse.json(
      { error: "The tutor response question must match the active session." },
      { status: 400 },
    )
  }

  const answer = typeof body.answer === "string" ? body.answer : ""
  const response = await createTutorResponse(
    {
      answer,
      allowLlmFallback: body.allowLlmFallback ?? false,
      mode: body.mode,
      questionId: body.questionId,
      sessionId: body.sessionId,
      topicId: body.topicId,
    },
    {
      studentId: session.anonymousStudentId ?? session.id,
    },
  )

  if (body.mode === "check") {
    await recordTutorSessionAttemptOutcome({
      answerPreview: answer,
      estimatedTokens: response.usage.estimatedTokens,
      sessionId: session.id,
      source: response.source,
      verdict: response.verdict,
    }).catch(() => undefined)
  }

  return NextResponse.json(response)
}
