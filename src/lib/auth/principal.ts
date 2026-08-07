import "server-only";

import {
  CLERK_IDENTITY_PROVIDER,
  getApplicationUserAccessByExternalIdentity,
  upsertClerkAccount,
  type ApplicationRole,
} from "@/lib/auth/account-repository";
import { getServerEnv } from "@/lib/env/server";

export type AuthenticatedPrincipal = {
  kind: "user";
  userId: string;
  displayName: string;
  email: string;
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

export async function resolveAuthenticatedPrincipal() {
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

  if (!account) {
    const clerkUser = await currentUser();
    if (!clerkUser || clerkUser.id !== clerkUserId) {
      return undefined;
    }

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

  return {
    kind: "user" as const,
    userId: account.id,
    displayName: account.displayName,
    email: account.email,
    roles: account.roles,
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
