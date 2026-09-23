import { describe, expect, it } from "vitest";

import {
  ghostPrincipalFor,
  GHOST_ROLES,
  GHOST_SESSION_COOKIE,
  isGhostUserId,
  parseGhostRole,
} from "@/lib/auth/ghost-session";
import {
  parseServerEnv,
  ServerEnvironmentValidationError,
  type ProcessEnvironment,
} from "@/lib/env/server";

describe("ghost session roles", () => {
  it("names the cookie and the two demo roles", () => {
    expect(GHOST_SESSION_COOKIE).toBe("ai-tutor-ghost-session");
    expect(GHOST_ROLES).toEqual(["professor", "student"]);
  });

  it("accepts only the exact demo role names", () => {
    expect(parseGhostRole("professor")).toBe("professor");
    expect(parseGhostRole("student")).toBe("student");
  });

  it("rejects anything that is not a demo role", () => {
    for (const value of [
      "Professor",
      "admin",
      "",
      " student ",
      undefined,
      null,
      42,
      ["professor"],
      { role: "professor" },
    ]) {
      expect(parseGhostRole(value)).toBeUndefined();
    }
  });
});

describe("ghost principals", () => {
  it("gives a professor both application roles", () => {
    const principal = ghostPrincipalFor("professor");

    expect(principal).toEqual({
      kind: "user",
      userId: "ghost:professor",
      displayName: "Ghost Professor",
      email: "ghost-professor@example.invalid",
      role: "professor",
      roles: ["student", "professor"],
    });
  });

  it("keeps a student to the student role", () => {
    const principal = ghostPrincipalFor("student");

    expect(principal).toEqual({
      kind: "user",
      userId: "ghost:student",
      displayName: "Ghost Student",
      email: "ghost-student@example.invalid",
      role: "student",
      roles: ["student"],
    });
  });

  it("marks demo identifiers so real accounts are never mistaken for them", () => {
    expect(isGhostUserId(ghostPrincipalFor("student").userId)).toBe(true);
    expect(isGhostUserId("11111111-2222-3333-4444-555555555555")).toBe(false);
  });
});

describe("ghost login environment validation", () => {
  it("stays off unless a local environment asks for it", () => {
    expect(
      parseServerEnv({ NODE_ENV: "development" }).GHOST_LOGIN_ENABLED,
    ).toBe(false);
    expect(parseServerEnv({ NODE_ENV: "test" }).GHOST_LOGIN_ENABLED).toBe(
      false,
    );
  });

  it("is available for local demonstrations without Clerk", () => {
    const env = parseServerEnv({
      GHOST_LOGIN_ENABLED: "true",
      NODE_ENV: "development",
    });

    expect(env.GHOST_LOGIN_ENABLED).toBe(true);
    expect(env.CLERK_ENABLED).toBe(false);
  });

  it("refuses to grant credential-free sessions in staging or production", () => {
    for (const environment of ["staging", "production"] as const) {
      expect(() =>
        parseServerEnv({
          ...strictEnvironment(environment),
          GHOST_LOGIN_ENABLED: "true",
        }),
      ).toThrowError(
        /GHOST_LOGIN_ENABLED must be false in deployed environments/,
      );
    }
  });

  it("refuses to grant credential-free sessions in a deployed Preview", () => {
    expect(() =>
      parseServerEnv({
        ANONYMOUS_PILOT_ENABLED: "false",
        APP_ENV: "preview",
        APP_URL: "https://preview-example.vercel.app",
        GHOST_LOGIN_ENABLED: "true",
      }),
    ).toThrowError(
      /GHOST_LOGIN_ENABLED must be false in deployed environments/,
    );
  });

  it("refuses to shadow a configured Clerk instance", () => {
    let raised: unknown;
    try {
      parseServerEnv({
        CLERK_SECRET_KEY: clerkKey("secret", "test"),
        GHOST_LOGIN_ENABLED: "true",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: clerkKey("publishable", "test"),
        NODE_ENV: "development",
      });
    } catch (error) {
      raised = error;
    }

    expect(raised).toBeInstanceOf(ServerEnvironmentValidationError);
    expect((raised as ServerEnvironmentValidationError).issues).toContain(
      "GHOST_LOGIN_ENABLED cannot be combined with configured Clerk keys; remove the ghost flag and sign in through Clerk.",
    );
  });

  it("rejects a value that is not a boolean", () => {
    expect(() =>
      parseServerEnv({ GHOST_LOGIN_ENABLED: "maybe", NODE_ENV: "development" }),
    ).toThrowError(/GHOST_LOGIN_ENABLED must be a boolean/);
  });
});

function strictEnvironment(
  environment: "production" | "staging",
): ProcessEnvironment {
  return {
    ANONYMOUS_PILOT_ENABLED: "false",
    AI_ENABLED: "false",
    APP_DEMO_MODE: "false",
    APP_ENV: environment,
    APP_URL:
      environment === "production"
        ? "https://tutor.example.edu"
        : "https://staging.example.edu",
    CLERK_SECRET_KEY:
      environment === "production"
        ? clerkKey("secret", "live")
        : clerkKey("secret", "test"),
    DATABASE_URL: "postgresql://user:password@database.example.edu/tutor",
    LOG_LEVEL: "info",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
      environment === "production"
        ? clerkKey("publishable", "live")
        : clerkKey("publishable", "test"),
    RATE_LIMIT_MAX_REQUESTS: "40",
    RATE_LIMIT_WINDOW_SECONDS: "60",
  };
}

function clerkKey(
  kind: "publishable" | "secret",
  environment: "live" | "test",
) {
  const prefix = kind === "publishable" ? `${"p"}k` : `${"s"}k`;
  return `${prefix}_${environment}_${"unit-test".repeat(4)}`;
}
