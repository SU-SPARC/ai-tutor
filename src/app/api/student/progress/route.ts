import { NextResponse } from "next/server";

import { authorizeApi, requireStudentAccess } from "@/lib/auth/authorization";
import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";
import { getStudentProgress } from "@/lib/data/student-progress";

export async function GET() {
  const access = await authorizeApi(() =>
    requireStudentAccess({ allowAnonymous: true, createAnonymous: true }),
  );
  if (!access.ok) {
    return access.response;
  }

  try {
    const progress = await getStudentProgress(access.authorization);
    return NextResponse.json({ progress });
  } catch {
    return dataServiceUnavailableResponse();
  }
}
