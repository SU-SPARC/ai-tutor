import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { safeReturnPath, signInPath } from "@/lib/auth/return-path";

export default auth((request) => {
  const pathname = request.nextUrl.pathname;
  const requestedPath = safeReturnPath(
    `${pathname}${request.nextUrl.search}`,
    "/",
  );
  const sessionUser = request.auth?.user;

  if (!sessionUser?.appUserId) {
    return NextResponse.redirect(
      new URL(signInPath(requestedPath), request.nextUrl),
    );
  }

  if (pathname.startsWith("/professor") || pathname.startsWith("/admin")) {
    const roles = sessionUser.roles ?? [];
    if (!roles.includes("professor") && !roles.includes("admin")) {
      return NextResponse.redirect(new URL("/forbidden", request.nextUrl));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/account", "/onboarding", "/professor/:path*", "/admin/:path*"],
};
