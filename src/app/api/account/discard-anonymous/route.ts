import { NextResponse } from "next/server";

import { clearAnonymousSession } from "@/lib/auth/anonymous-session";
import { AuthenticationRequiredError, requireUser } from "@/lib/auth/principal";

export async function POST() {
  try {
    await requireUser();
    await clearAnonymousSession();
    return NextResponse.json({ discarded: true });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }
}
