import { NextResponse } from "next/server"

import { getUsageDashboard } from "@/lib/tutor/usage-control"
import { authorizeProfessorReview } from "@/lib/tutor/professor-auth"

export async function GET(request: Request) {
  const auth = authorizeProfessorReview(request.headers)

  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status })
  }

  try {
    return NextResponse.json({ usage: await getUsageDashboard() })
  } catch {
    return NextResponse.json(
      {
        error:
          "Usage data is unavailable. Check the durable database configuration.",
      },
      { status: 503 },
    )
  }
}
