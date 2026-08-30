import { NextResponse } from "next/server";

import { authorizeApi, requireProfessor } from "@/lib/auth/authorization";
import {
  listPilotOperationalDiagnostics,
  pilotRequestId,
} from "@/lib/observability/pilot-operations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ROUTE = "/api/professor/operations";

export async function GET(request: Request) {
  const requestId = pilotRequestId(request);
  const access = await authorizeApi(requireProfessor, {
    request,
    requestId,
    route: ROUTE,
  });
  if (!access.ok) {
    return access.response;
  }

  return NextResponse.json(
    {
      diagnostics: listPilotOperationalDiagnostics(),
      scope:
        "Recent privacy-safe events from this warm application instance; protected hosting logs are the cross-instance operational source.",
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "X-Request-Id": requestId,
      },
    },
  );
}
