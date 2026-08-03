import { NextResponse } from "next/server";

import { auth } from "@/auth";

export default auth((request) => {
  const pathname = request.nextUrl.pathname;
  const sessionUser = request.auth?.user;

  if (!sessionUser?.appUserId) {
    const signInUrl = new URL("/sign-in", request.nextUrl);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  const roles = sessionUser.roles ?? [];
  if (!roles.includes("professor") && !roles.includes("admin")) {
    return NextResponse.redirect(new URL("/forbidden", request.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/professor/:path*", "/admin/:path*"],
};
