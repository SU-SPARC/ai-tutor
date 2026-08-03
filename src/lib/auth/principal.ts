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

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Authentication is required.");
    this.name = "AuthenticationRequiredError";
  }
}

export class AuthorizationDeniedError extends Error {
  constructor() {
    super("You do not have permission to perform this action.");
    this.name = "AuthorizationDeniedError";
  }
}

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

export async function requireUser() {
  const principal = await resolveAuthenticatedPrincipal();
  if (!principal) {
    throw new AuthenticationRequiredError();
  }
  return principal;
}

export async function requireRole(role: "professor" | "admin") {
  const principal = await requireUser();
  const allowed =
    principal.roles.includes(role) ||
    (role === "professor" && principal.roles.includes("admin"));

  if (!allowed) {
    throw new AuthorizationDeniedError();
  }
  return principal;
}

export async function authorizeApiRole(role: "professor" | "admin") {
  try {
    const principal = await requireRole(role);
    return { ok: true as const, principal };
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return {
        ok: false as const,
        response: Response.json({ error: error.message }, { status: 401 }),
      };
    }
    if (error instanceof AuthorizationDeniedError) {
      return {
        ok: false as const,
        response: Response.json({ error: error.message }, { status: 403 }),
      };
    }
    throw error;
  }
}

export function setPrincipalResolverForTests(resolver?: PrincipalResolver) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "Principal injection is restricted to the test environment.",
    );
  }
  testPrincipalResolver = resolver;
}
