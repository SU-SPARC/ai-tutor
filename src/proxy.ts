import { clerkMiddleware } from "@clerk/nextjs/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { safeReturnPath, signInPath } from "@/lib/auth/return-path";
import { getServerEnv } from "@/lib/env/server";

const configuredClerkProxy = clerkMiddleware(async (auth, request) => {
  const pathname = request.nextUrl.pathname;
  if (!isCoarselyProtectedPath(pathname)) {
    return NextResponse.next();
  }

  const requestedPath = safeReturnPath(
    `${pathname}${request.nextUrl.search}`,
    "/",
  );
  const session = await auth();

  if (!session.isAuthenticated || !session.userId) {
    return NextResponse.redirect(
      new URL(signInPath(requestedPath), request.nextUrl),
    );
  }

  return NextResponse.next();
});

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  const env = getServerEnv();
  if (env.CLERK_ENABLED) {
    return configuredClerkProxy(request, event);
  }

  if (!isCoarselyProtectedPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const requestedPath = safeReturnPath(
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
    "/",
  );
  return NextResponse.redirect(
    new URL(signInPath(requestedPath), request.nextUrl),
  );
}

function isCoarselyProtectedPath(pathname: string) {
  return (
    pathname === "/account" ||
    pathname === "/onboarding" ||
    pathname === "/professor" ||
    pathname.startsWith("/professor/")
  );
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
