import { NextResponse } from "next/server"

import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable"
import { getTutorSession } from "@/lib/data/tutor-session-repository"

type SessionRouteContext = {
  params: Promise<{ sessionId: string }> | { sessionId: string }
}

export async function GET(_request: Request, context: SessionRouteContext) {
  const sessionId = await getSessionId(context)
  let session

  try {
    session = await getTutorSession(sessionId)
  } catch {
    return dataServiceUnavailableResponse()
  }

  if (!session) {
    return NextResponse.json(
      { error: "Tutor session was not found." },
      { status: 404 },
    )
  }

  return NextResponse.json({ session })
}

async function getSessionId(context: SessionRouteContext) {
  const params = await context.params
  return params.sessionId
}
