import { NextResponse } from "next/server";

import {
  AnonymousIdentityAlreadyClaimedError,
  claimAnonymousIdentity,
} from "@/lib/auth/anonymous-claims";
import {
  clearAnonymousSession,
  readAnonymousCookieSubject,
} from "@/lib/auth/anonymous-session";
import { authorizeApi, requireStudent } from "@/lib/auth/authorization";
import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";

export async function POST() {
  const access = await authorizeApi(requireStudent);
  if (!access.ok) {
    return access.response;
  }

  try {
    const anonymousId = await readAnonymousCookieSubject();
    if (!anonymousId) {
      return NextResponse.json(
        { error: "No signed browser practice identity is available." },
        { status: 400 },
      );
    }

    const result = await claimAnonymousIdentity({
      anonymousId,
      source: "signed_cookie",
      userId: access.authorization.principal.userId,
    });
    await clearAnonymousSession();
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AnonymousIdentityAlreadyClaimedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return dataServiceUnavailableResponse();
  }
}
