import { NextResponse } from "next/server"

import {
  ANONYMOUS_STUDENT_HEADER,
  isAnonymousStudentId,
} from "@/lib/auth/anonymous-student"
import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable"
import { getStudentProgress } from "@/lib/data/student-progress"

export async function GET(request: Request) {
  const anonymousStudentId = request.headers.get(ANONYMOUS_STUDENT_HEADER)

  if (!isAnonymousStudentId(anonymousStudentId)) {
    return NextResponse.json(
      { error: "A valid anonymous student session is required." },
      { status: 400 },
    )
  }

  try {
    const progress = await getStudentProgress(anonymousStudentId)
    return NextResponse.json({ progress })
  } catch {
    return dataServiceUnavailableResponse()
  }
}
