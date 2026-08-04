import "server-only";

import {
  getApplicationUserAccess,
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

  const { auth } = await import("@/auth");
  const session = await auth();
  const sessionUser = session?.user;

  if (!sessionUser?.appUserId || !sessionUser.sessionVersion) {
    return undefined;
  }

  const env = getServerEnv();

  if (
    sessionUser.authMode === "test" &&
    env.AUTH_TEST_MODE &&
    !env.IS_DEPLOYED_ENVIRONMENT
  ) {
    return {
      kind: "user" as const,
      userId: sessionUser.appUserId,
      displayName: sessionUser.name ?? "Local test user",
      email: sessionUser.email ?? "local-test@example.invalid",
      roles: sessionUser.roles,
    };
  }

  if (sessionUser.authMode !== "oidc") {
    return undefined;
  }

  const account = await getApplicationUserAccess(sessionUser.appUserId);

  if (
    !account ||
    account.status !== "active" ||
    account.sessionVersion !== sessionUser.sessionVersion
  ) {
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
