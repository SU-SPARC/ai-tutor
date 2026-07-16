import { NextResponse } from "next/server"

import {
  getContentRepositoryMode,
  getProfessorPracticeAnalytics,
  getReviewQueue,
} from "@/lib/data/data-store"
import { getUsageDashboard } from "@/lib/tutor/usage-control"
import { authorizeProfessorReview } from "@/lib/tutor/professor-auth"
import { buildProfessorAnalyticsDashboard } from "@/lib/tutor/professor-admin"

export async function GET(request: Request) {
  const auth = authorizeProfessorReview(request.headers)

  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status })
  }

  try {
    const [reviewQueue, usage, practice] = await Promise.all([
      getReviewQueue(),
      getUsageDashboard(),
      getProfessorPracticeAnalytics(),
    ])

    return NextResponse.json({
      analytics: buildProfessorAnalyticsDashboard({
        mode: getContentRepositoryMode(),
        practice,
        reviewQueue,
        usage,
      }),
    })
  } catch {
    return NextResponse.json(
      { error: "Professor analytics are unavailable right now." },
      { status: 503 },
    )
  }
}
