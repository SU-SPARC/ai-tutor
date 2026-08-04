import "server-only";

import {
  APPLICATION_ROLES,
  type ApplicationRole,
  type ApplicationUserAccess,
} from "@/lib/auth/account-repository";
import type { JWT } from "next-auth/jwt";

export const AUTH_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
export const AUTH_SESSION_CLOCK_SKEW_SECONDS = 60;

export type ApplicationSessionClaims = {
  appUserId: string;
  authMode: "oidc" | "test";
  roles: ApplicationRole[];
  sessionStartedAt: number;
  sessionVersion: number;
};

export function authSessionCookie(appUrl: string) {
  const secure = new URL(appUrl).protocol === "https:";

  return {
    name: `${secure ? "__Host-" : ""}authjs.session-token`,
    options: {
      httpOnly: true,
      maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
      path: "/",
      priority: "high" as const,
      sameSite: "lax" as const,
      secure,
    },
  };
}

export function readApplicationSessionClaims(
  token: JWT | null | undefined,
): ApplicationSessionClaims | undefined {
  if (
    !token ||
    typeof token.appUserId !== "string" ||
    !token.appUserId ||
    token.sub !== token.appUserId ||
    (token.authMode !== "oidc" && token.authMode !== "test") ||
    !Number.isInteger(token.sessionVersion) ||
    Number(token.sessionVersion) < 1 ||
    !Number.isInteger(token.sessionStartedAt) ||
    Number(token.sessionStartedAt) < 1 ||
    !Array.isArray(token.roles)
  ) {
    return undefined;
  }

  const roles = token.roles.filter(isApplicationRole);
  if (roles.length !== token.roles.length) {
    return undefined;
  }

  return {
    appUserId: token.appUserId,
    authMode: token.authMode,
    roles,
    sessionStartedAt: Number(token.sessionStartedAt),
    sessionVersion: Number(token.sessionVersion),
  };
}

export function isApplicationSessionCurrent(
  claims: ApplicationSessionClaims,
  account: ApplicationUserAccess | undefined,
) {
  return Boolean(
    account &&
    account.id === claims.appUserId &&
    account.status === "active" &&
    account.sessionVersion === claims.sessionVersion,
  );
}

export function isApplicationSessionExpired(
  claims: ApplicationSessionClaims,
  nowSeconds = epochSeconds(),
) {
  return (
    claims.sessionStartedAt > nowSeconds + AUTH_SESSION_CLOCK_SKEW_SECONDS ||
    claims.sessionStartedAt + AUTH_SESSION_MAX_AGE_SECONDS <= nowSeconds
  );
}

export function applicationSessionExpiresAt(claims: ApplicationSessionClaims) {
  return new Date(
    (claims.sessionStartedAt + AUTH_SESSION_MAX_AGE_SECONDS) * 1_000,
  ).toISOString();
}

export function epochSeconds() {
  return Math.floor(Date.now() / 1_000);
}

function isApplicationRole(value: unknown): value is ApplicationRole {
  return (
    typeof value === "string" &&
    (APPLICATION_ROLES as readonly string[]).includes(value)
  );
}
