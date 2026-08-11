import { Suspense } from "react";
import Link from "next/link";
import { SignOutButton } from "@clerk/nextjs";
import { GraduationCap } from "lucide-react";

import { CurrentPageSignInLink } from "@/components/auth/current-page-sign-in-link";
import {
  currentAuthenticatedUser,
  hasPermission,
} from "@/lib/auth/authorization";

const navigationClassName =
  "rounded-sm text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export async function AccountActions() {
  let principal: Awaited<ReturnType<typeof currentAuthenticatedUser>>;
  try {
    principal = await currentAuthenticatedUser();
  } catch {
    // Header decoration must not make otherwise-public content unavailable
    // when identity storage is temporarily unreachable.
    return <SignInNavigation />;
  }

  if (!principal) {
    return <SignInNavigation />;
  }

  const canAccessProfessorPanel = hasPermission(principal, "professor");

  return (
    <div className="flex items-center gap-3">
      {canAccessProfessorPanel ? (
        <Link
          href="/professor"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <GraduationCap className="h-4 w-4" aria-hidden="true" />
          Professor Panel
        </Link>
      ) : null}
      <Link href="/account" className={navigationClassName}>
        Account
      </Link>
      <SignOutButton redirectUrl="/">
        <button type="button" className={navigationClassName}>
          Sign out
        </button>
      </SignOutButton>
    </div>
  );
}

function SignInNavigation() {
  return (
    <Suspense
      fallback={
        <Link href="/sign-in" className={navigationClassName}>
          Sign in
        </Link>
      }
    >
      <CurrentPageSignInLink />
    </Suspense>
  );
}
