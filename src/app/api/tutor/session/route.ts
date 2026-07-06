import { NextResponse } from "next/server"

import { createTutorSession } from "@/lib/data/tutor-session-repository"

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

  if (!questionId) {
    return NextResponse.json(
      { error: "questionId is required." },
      { status: 400 },
    )
  }

  const session = await createTutorSession({
    anonymousStudentId: optionalString(body.anonymousStudentId),
    questionId,
  })

  return NextResponse.json({ session }, { status: 201 })
}

function requiredString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}
