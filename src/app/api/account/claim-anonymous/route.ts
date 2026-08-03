import { NextResponse } from "next/server";

import {
  AnonymousIdentityAlreadyClaimedError,
  claimAnonymousIdentity,
} from "@/lib/auth/anonymous-claims";
import {
  clearAnonymousSession,
  readAnonymousCookieSubject,
} from "@/lib/auth/anonymous-session";
import { AuthenticationRequiredError, requireUser } from "@/lib/auth/principal";
import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";

export async function POST() {
  try {
    const principal = await requireUser();
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
      userId: principal.userId,
    });
    await clearAnonymousSession();
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof AnonymousIdentityAlreadyClaimedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return dataServiceUnavailableResponse();
  }
}
