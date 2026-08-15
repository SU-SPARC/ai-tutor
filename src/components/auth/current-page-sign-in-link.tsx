"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { navigationClassName } from "@/components/auth/navigation-class-name";
import { safeReturnPath, signInPath } from "@/lib/auth/return-path";

export function CurrentPageSignInLink() {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const returnTo = safeReturnPath(`${pathname}${query ? `?${query}` : ""}`);

  return (
    <Link href={signInPath(returnTo)} className={navigationClassName}>
      Sign in
    </Link>
  );
}
