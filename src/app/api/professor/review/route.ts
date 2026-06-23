import { NextResponse } from "next/server"

import { updateReviewCandidateStatus } from "@/lib/data/data-store"
import { authorizeProfessorReview } from "@/lib/tutor/professor-auth"

type ReviewBody = {
  action?: "approve" | "reject"
  candidateId?: string
}

export async function POST(request: Request) {
  const auth = authorizeProfessorReview(request.headers)

  if (!auth.authorized) {
    return NextResponse.json(
      { error: auth.reason },
      { status: auth.status },
    )
  }

  let body: ReviewBody

  try {
    body = (await request.json()) as ReviewBody
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    )
  }

  if (!body.candidateId || !body.action) {
    return NextResponse.json(
      { error: "candidateId and action are required." },
      { status: 400 },
    )
  }

  const updated = updateReviewCandidateStatus(body.candidateId, body.action)

  if (!updated) {
    return NextResponse.json(
      { error: "Review candidate was not found." },
      { status: 404 },
    )
  }

  return NextResponse.json({ candidate: updated })
}
