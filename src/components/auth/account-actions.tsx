import { Suspense } from "react";
import Link from "next/link";
import { SignOutButton } from "@clerk/nextjs";
import { GraduationCap } from "lucide-react";

import { CurrentPageSignInLink } from "@/components/auth/current-page-sign-in-link";
import { Button } from "@/components/ui/button";
import { navigationClassName } from "@/components/auth/navigation-class-name";
import {
  currentAuthenticatedUser,
  hasPermission,
} from "@/lib/auth/authorization";

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
        <Button asChild size="sm">
          <Link href="/professor">
            <GraduationCap aria-hidden="true" />
            Professor Panel
          </Link>
        </Button>
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
