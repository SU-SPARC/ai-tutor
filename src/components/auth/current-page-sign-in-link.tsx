"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { safeReturnPath, signInPath } from "@/lib/auth/return-path";

export function CurrentPageSignInLink() {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const returnTo = safeReturnPath(`${pathname}${query ? `?${query}` : ""}`);

  return (
    <Link
      href={signInPath(returnTo)}
      className="rounded-sm text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Sign in
    </Link>
  );
}
