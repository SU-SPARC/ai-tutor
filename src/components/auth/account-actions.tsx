import { Suspense } from "react";
import Link from "next/link";

import { signOutAction } from "@/app/auth-actions";
import { CurrentPageSignInLink } from "@/components/auth/current-page-sign-in-link";
import { resolveAuthenticatedPrincipal } from "@/lib/auth/principal";

const navigationClassName =
  "rounded-sm text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export async function AccountActions() {
  let principal: Awaited<ReturnType<typeof resolveAuthenticatedPrincipal>>;
  try {
    principal = await resolveAuthenticatedPrincipal();
  } catch {
    // Header decoration must not make otherwise-public content unavailable
    // when identity storage is temporarily unreachable.
    return <SignInNavigation />;
  }

  if (!principal) {
    return <SignInNavigation />;
  }

  const canAccessInstructorTools =
    principal.roles.includes("professor") || principal.roles.includes("admin");

  return (
    <div className="flex items-center gap-3">
      {canAccessInstructorTools ? (
        <Link href="/professor" className={navigationClassName}>
          Instructor tools
        </Link>
      ) : null}
      <Link href="/account" className={navigationClassName}>
        Account
      </Link>
      <form action={signOutAction}>
        <button type="submit" className={navigationClassName}>
          Sign out
        </button>
      </form>
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
