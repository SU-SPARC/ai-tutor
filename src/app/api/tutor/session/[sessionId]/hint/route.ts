import { NextResponse } from "next/server";

import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";
import { revealTutorSessionHint } from "@/lib/data/tutor-session-repository";
import { resolveStudentOwner } from "@/lib/auth/anonymous-session";

type SessionRouteContext = {
  params: Promise<{ sessionId: string }> | { sessionId: string };
};

export async function POST(_request: Request, context: SessionRouteContext) {
  const sessionId = await getSessionId(context);
  let session;

  try {
    const owner = await resolveStudentOwner();
    session = owner
      ? await revealTutorSessionHint(sessionId, owner)
      : undefined;
  } catch {
    return dataServiceUnavailableResponse();
  }

  if (!session) {
    return NextResponse.json(
      { error: "Tutor session was not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ session });
}

async function getSessionId(context: SessionRouteContext) {
  const params = await context.params;
  return params.sessionId;
}
