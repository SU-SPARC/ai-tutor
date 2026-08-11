import "server-only";

import {
  CLERK_IDENTITY_PROVIDER,
  getApplicationUserAccessByExternalIdentity,
  syncClerkRoleProjection,
  upsertClerkAccount,
} from "@/lib/auth/account-repository";
import { getServerEnv } from "@/lib/env/server";
import {
  applicationRoleFromPublicMetadata,
  type ApplicationRole,
} from "@/lib/auth/roles";

export type AuthenticatedPrincipal = {
  kind: "user";
  userId: string;
  displayName: string;
  email: string;
  role: ApplicationRole;
  roles: ApplicationRole[];
};

export type AnonymousPrincipal = {
  kind: "anonymous";
  anonymousId: string;
};

export type Principal = AuthenticatedPrincipal | AnonymousPrincipal;
export type StudentOwner =
  | { kind: "user"; userId: string }
  | { kind: "anonymous"; anonymousId: string };

type PrincipalResolver = () => Promise<AuthenticatedPrincipal | undefined>;
let testPrincipalResolver: PrincipalResolver | undefined;

export async function resolveAuthenticatedPrincipal(): Promise<
  AuthenticatedPrincipal | undefined
> {
  if (process.env.NODE_ENV === "test") {
    return testPrincipalResolver?.();
  }

  const env = getServerEnv();
  if (!env.CLERK_ENABLED) {
    return undefined;
  }

  const { auth, currentUser } = await import("@clerk/nextjs/server");
  const session = await auth();
  const clerkUserId = session.userId;

  if (!session.isAuthenticated || !clerkUserId) {
    return undefined;
  }

  let account = await getApplicationUserAccessByExternalIdentity(
    CLERK_IDENTITY_PROVIDER,
    clerkUserId,
  );

  const clerkUser = await currentUser();
  if (!clerkUser || clerkUser.id !== clerkUserId) {
    return undefined;
  }

  if (!account) {
    const primaryEmail = clerkUser.emailAddresses.find(
      ({ id }) => id === clerkUser.primaryEmailAddressId,
    );
    if (
      !primaryEmail?.emailAddress ||
      primaryEmail.verification?.status !== "verified"
    ) {
      return undefined;
    }

    const displayName =
      clerkUser.fullName?.trim() ||
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
      primaryEmail.emailAddress;

    account = await upsertClerkAccount({
      clerkUserId,
      displayName,
      email: primaryEmail.emailAddress,
    });
  }

  if (account.status !== "active") {
    return undefined;
  }

  // Read the authoritative Backend User on every server boundary instead of
  // trusting a potentially stale custom session claim. A Dashboard role
  // change is therefore visible on the next server request without requiring
  // the user to sign out and back in.
  const role = applicationRoleFromPublicMetadata(clerkUser.publicMetadata);
  await syncClerkRoleProjection(account.id, role);
  const roles: ApplicationRole[] =
    role === "professor" ? ["student", "professor"] : ["student"];

  return {
    kind: "user" as const,
    userId: account.id,
    displayName: account.displayName,
    email: account.email,
    role,
    roles,
  };
}

export function setPrincipalResolverForTests(resolver?: PrincipalResolver) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "Principal injection is restricted to the test environment.",
    );
  }
  testPrincipalResolver = resolver;
}
