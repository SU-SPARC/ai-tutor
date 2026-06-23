import { NextResponse } from "next/server"

import { createTutorResponse } from "@/lib/tutor/tutor-engine"
import type { TutorRequest } from "@/lib/types"

export async function POST(request: Request) {
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

  const response = await createTutorResponse({
    answer: body.answer ?? "",
    allowLlmFallback: body.allowLlmFallback ?? false,
    mode: body.mode,
    questionId: body.questionId,
    sessionId: body.sessionId,
    topicId: body.topicId,
  })

  return NextResponse.json(response)
}
