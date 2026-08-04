import { NextResponse } from "next/server";

import { clearAnonymousSession } from "@/lib/auth/anonymous-session";
import { authorizeApi, requireStudent } from "@/lib/auth/authorization";

export async function POST() {
  const access = await authorizeApi(requireStudent);
  if (!access.ok) {
    return access.response;
  }

  await clearAnonymousSession();
  return NextResponse.json({ discarded: true });
}
