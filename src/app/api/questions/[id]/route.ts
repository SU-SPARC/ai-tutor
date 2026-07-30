import { NextResponse } from "next/server"

import { normalizeDetail } from "@/lib/api/question-serialization"
import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable"
import { getApprovedQuestionById } from "@/lib/data/data-store"
import { isStudentFacingQuestion } from "@/lib/data/demo-repository"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  if (!id?.trim()) {
    return NextResponse.json(
      { error: "A question id is required." },
      { status: 400 },
    )
  }

  try {
    const question = await getApprovedQuestionById(id)

    // Only approved, public, student-facing questions are served here. Drafts
    // (needs_review / generated_unverified) return 404, never their content.
    if (!question || !isStudentFacingQuestion(question)) {
      return NextResponse.json(
        { error: `Question not found: ${id}` },
        { status: 404 },
      )
    }

    return NextResponse.json({ question: normalizeDetail(question) })
  } catch {
    return dataServiceUnavailableResponse()
  }
}
