import { NextResponse } from "next/server";

import {
  AnonymousIdentityAlreadyClaimedError,
  claimAnonymousIdentity,
} from "@/lib/auth/anonymous-claims";
import { isAnonymousStudentId } from "@/lib/auth/anonymous-student";
import { authorizeApi, requireStudent } from "@/lib/auth/authorization";
import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";
import { getServerEnv } from "@/lib/env/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const env = getServerEnv();
  if (
    !env.LEGACY_ANONYMOUS_MIGRATION_ENABLED ||
    !env.LEGACY_ANONYMOUS_MIGRATION_EXPIRES_AT ||
    Date.now() >= Date.parse(env.LEGACY_ANONYMOUS_MIGRATION_EXPIRES_AT)
  ) {
    return NextResponse.json(
      { error: "The legacy browser-progress migration window is closed." },
      { status: 410 },
    );
  }

  const rateLimit = checkRateLimit(`legacy-claim:${getClientIp(request)}`, {
    max: 5,
    windowMs: 60 * 60 * 1_000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many migration attempts." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  const access = await authorizeApi(requireStudent);
  if (!access.ok) {
    return access.response;
  }

  try {
    const body = (await request.json()) as { legacyAnonymousId?: unknown };
    if (!isAnonymousStudentId(body.legacyAnonymousId)) {
      return NextResponse.json(
        { error: "A valid legacy browser identity is required." },
        { status: 400 },
      );
    }
    const result = await claimAnonymousIdentity({
      anonymousId: body.legacyAnonymousId,
      source: "legacy_local_storage",
      userId: access.authorization.principal.userId,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AnonymousIdentityAlreadyClaimedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Request body must be valid JSON." },
        { status: 400 },
      );
    }
    return dataServiceUnavailableResponse();
  }
}
