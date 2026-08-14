import { NextResponse } from "next/server";

import { authorizeApi, requireStudent } from "@/lib/auth/authorization";
import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";
import { getStudentProgress } from "@/lib/data/student-progress";

export async function GET() {
  const access = await authorizeApi(requireStudent);
  if (!access.ok) {
    return access.response;
  }

  try {
    const progress = await getStudentProgress(access.authorization);
    return NextResponse.json(
      { progress },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch {
    return dataServiceUnavailableResponse();
  }
}
