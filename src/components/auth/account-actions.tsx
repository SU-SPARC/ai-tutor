import { Suspense } from "react";
import Link from "next/link";
import { SignOutButton } from "@clerk/nextjs";
import { GraduationCap, LogOut, UserRound } from "lucide-react";

import { signOutGhost } from "@/app/sign-in/ghost-actions";
import { CurrentPageSignInLink } from "@/components/auth/current-page-sign-in-link";
import {
  accountMenuItemClassName,
  navigationClassName,
} from "@/components/auth/navigation-class-name";
import { AccountMenu } from "@/components/shell/account-menu";
import {
  currentAuthenticatedUser,
  hasPermission,
} from "@/lib/auth/authorization";
import { isGhostUserId } from "@/lib/auth/ghost-session";

type EnvironmentLabel = "Development" | "Local demo" | "Preview" | "Preview demo";

/**
 * The header's account control. Signed out: a "Sign in" link. Signed in: the
 * account disclosure (Professor workspace for professors, Account, Sign out, and
 * the non-production line). Roles are never printed.
 */
export async function AccountActions({
  environmentLabel,
}: { environmentLabel?: EnvironmentLabel } = {}) {
  let principal: Awaited<ReturnType<typeof currentAuthenticatedUser>>;
  try {
    principal = await currentAuthenticatedUser();
  } catch {
    // Header decoration must not make otherwise-public content unavailable
    // when identity storage is temporarily unreachable.
    return <SignInNavigation environmentLabel={environmentLabel} />;
  }

  if (!principal) {
    return <SignInNavigation environmentLabel={environmentLabel} />;
  }

  const canAccessProfessorPanel = hasPermission(principal, "professor");

  return (
    <AccountMenu environmentLabel={environmentLabel}>
      {canAccessProfessorPanel ? (
        <Link href="/professor" className={accountMenuItemClassName}>
          <GraduationCap aria-hidden="true" />
          Professor workspace
        </Link>
      ) : null}
      <Link href="/account" className={accountMenuItemClassName}>
        <UserRound aria-hidden="true" />
        Account
      </Link>
      {isGhostUserId(principal.userId) ? (
        // A demo session has no Clerk provider mounted above it, so signing out
        // has to clear the cookie itself instead of asking Clerk to end a
        // session that never existed.
        <form action={signOutGhost}>
          <button type="submit" className={accountMenuItemClassName}>
            <LogOut aria-hidden="true" />
            Sign out
          </button>
        </form>
      ) : (
        <SignOutButton redirectUrl="/">
          <button type="button" className={accountMenuItemClassName}>
            <LogOut aria-hidden="true" />
            Sign out
          </button>
        </SignOutButton>
      )}
    </AccountMenu>
  );
}

function SignInNavigation({
  environmentLabel,
}: {
  environmentLabel?: EnvironmentLabel;
}) {
  return (
    <div className="flex items-center gap-2">
      {environmentLabel ? (
        // Signed out there is no account menu to hold it, so it stays as a
        // quiet caption beside Sign in (desktop only; the phone menu has it).
        <span
          className="hidden type-caption lg:inline"
          title={`Non-production environment: ${environmentLabel}`}
        >
          {environmentLabel}
        </span>
      ) : null}
      <Suspense
        fallback={
          <Link href="/sign-in" className={navigationClassName}>
            Sign in
          </Link>
        }
      >
        <CurrentPageSignInLink />
      </Suspense>
    </div>
  );
}
