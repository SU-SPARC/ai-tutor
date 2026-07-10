import { NextResponse } from "next/server"

import { createTutorSession } from "@/lib/data/tutor-session-repository"
import { isAnonymousStudentId } from "@/lib/auth/anonymous-student"

type CreateSessionBody = {
  anonymousStudentId?: unknown
  questionId?: unknown
}

export async function POST(request: Request) {
  let body: CreateSessionBody

  try {
    body = (await request.json()) as CreateSessionBody
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    )
  }

  const questionId = requiredString(body.questionId)
  const anonymousStudentId = requiredString(body.anonymousStudentId)

  if (!questionId) {
    return NextResponse.json(
      { error: "questionId is required." },
      { status: 400 },
    )
  }

  if (!isAnonymousStudentId(anonymousStudentId)) {
    return NextResponse.json(
      { error: "A valid anonymousStudentId is required." },
      { status: 400 },
    )
  }

  const session = await createTutorSession({
    anonymousStudentId,
    questionId,
  })

  return NextResponse.json({ session }, { status: 201 })
}

function requiredString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}
