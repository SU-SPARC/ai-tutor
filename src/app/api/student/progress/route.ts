import { NextResponse } from "next/server";

import {
  AnonymousPilotUnavailableError,
  resolveStudentOwner,
} from "@/lib/auth/anonymous-session";
import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";
import { getStudentProgress } from "@/lib/data/student-progress";

export async function GET() {
  try {
    const owner = await resolveStudentOwner({ createAnonymous: true });

    if (!owner) {
      return NextResponse.json(
        { error: "A valid student session is required." },
        { status: 401 },
      );
    }

    const progress = await getStudentProgress(owner);
    return NextResponse.json({ progress });
  } catch (error) {
    if (error instanceof AnonymousPilotUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return dataServiceUnavailableResponse();
  }
}
