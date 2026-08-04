import { readFile } from "node:fs/promises";

import { Auth } from "@auth/core";
import { decode, encode } from "@auth/core/jwt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SESSION_SECRET = "B7vQ2kX9mR4tL8wC6zH3pN5sY1dF0aGJ";

const mocks = vi.hoisted(() => ({
  getApplicationUserAccess: vi.fn(),
  invalidateApplicationSessionOnLogout: vi.fn(),
  upsertOidcAccount: vi.fn(),
}));

vi.mock("@/lib/env/server", () => ({
  getServerEnv: () => ({
    APP_URL: "https://preview.example.edu",
    AUTH_OIDC_ENABLED: false,
    AUTH_SESSION_SECRET: "B7vQ2kX9mR4tL8wC6zH3pN5sY1dF0aGJ",
    AUTH_TEST_MODE: true,
    IS_DEPLOYED_ENVIRONMENT: false,
  }),
}));

vi.mock("next-auth", () => ({
  default: () => ({
    auth: vi.fn(),
    handlers: {},
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock("@/lib/auth/account-repository", () => ({
  APPLICATION_ROLES: ["student", "professor", "admin"],
  IdentityConflictError: class IdentityConflictError extends Error {},
  getApplicationUserAccess: mocks.getApplicationUserAccess,
  invalidateApplicationSessionOnLogout:
    mocks.invalidateApplicationSessionOnLogout,
  upsertOidcAccount: mocks.upsertOidcAccount,
}));

import { authConfig } from "@/auth";
import {
  AUTH_SESSION_MAX_AGE_SECONDS,
  authSessionCookie,
  epochSeconds,
} from "@/lib/auth/session-policy";

const secureCookie = authSessionCookie("https://preview.example.edu");

beforeEach(() => {
  mocks.getApplicationUserAccess.mockReset();
  mocks.invalidateApplicationSessionOnLogout.mockReset();
  mocks.upsertOidcAccount.mockReset();
  mocks.invalidateApplicationSessionOnLogout.mockResolvedValue({
    invalidated: true,
    sessionVersion: 2,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("authentication session cookies", () => {
  it("uses a host-only secure cookie in HTTPS environments", () => {
    expect(secureCookie).toEqual({
      name: "__Host-authjs.session-token",
      options: {
        httpOnly: true,
        maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
        path: "/",
        priority: "high",
        sameSite: "lax",
        secure: true,
      },
    });
    expect(secureCookie.options).not.toHaveProperty("domain");

    expect(authSessionCookie("http://localhost:3000")).toMatchObject({
      name: "authjs.session-token",
      options: { httpOnly: true, sameSite: "lax", secure: false },
    });
  });

  it("returns no session when the cookie is missing", async () => {
    const response = await readSession();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toBeNull();
    expect(sessionCookieHeaders(response)).toEqual([]);
  });

  it("clears an invalid cookie without logging its value", async () => {
    const invalidToken = "raw-invalid-session-token-never-log-this";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await readSession(invalidToken);
    const serialized = await response.text();
    const logged = JSON.stringify(error.mock.calls);

    expect(serialized).toBe("null");
    expect(sessionCookieHeaders(response)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^__Host-authjs\.session-token=;.*Max-Age=0.*HttpOnly.*Secure.*SameSite=Lax/i,
        ),
      ]),
    );
    expect(logged).not.toContain(invalidToken);
    expect(logged).not.toMatch(/raw-invalid-session-token/);
  });

  it("clears a cryptographically expired session", async () => {
    const response = await readSession(await issueSession({}, -60));

    await expect(response.json()).resolves.toBeNull();
    expect(sessionCookieHeaders(response).join("\n")).toContain("Max-Age=0");
  });

  it("enforces the absolute application expiry even after JWT rotation", async () => {
    const response = await readSession(
      await issueSession({
        sessionStartedAt: epochSeconds() - AUTH_SESSION_MAX_AGE_SECONDS - 1,
      }),
    );

    await expect(response.json()).resolves.toBeNull();
    expect(sessionCookieHeaders(response).join("\n")).toContain("Max-Age=0");
  });

  it("rejects and clears a revoked session version", async () => {
    mocks.getApplicationUserAccess.mockResolvedValue(
      activeAccount({
        sessionVersion: 2,
      }),
    );

    const response = await readSession(await issueSession());

    await expect(response.json()).resolves.toBeNull();
    expect(mocks.getApplicationUserAccess).toHaveBeenCalledWith("user:student");
    expect(sessionCookieHeaders(response).join("\n")).toContain("Max-Age=0");
  });

  it.each([
    ["missing", undefined],
    ["disabled", activeAccount({ status: "disabled" })],
    ["deleted", activeAccount({ status: "deleted" })],
    ["not yet active", activeAccount({ status: "invited" })],
  ])(
    "rejects and clears a session for a %s account",
    async (_label, account) => {
      mocks.getApplicationUserAccess.mockResolvedValue(account);

      const response = await readSession(await issueSession());

      await expect(response.json()).resolves.toBeNull();
      expect(mocks.getApplicationUserAccess).toHaveBeenCalledWith(
        "user:student",
      );
      expect(sessionCookieHeaders(response).join("\n")).toContain("Max-Age=0");
    },
  );

  it("replaces elevated JWT role claims with current database roles", async () => {
    mocks.getApplicationUserAccess.mockResolvedValue(
      activeAccount({ roles: ["student"] }),
    );

    const response = await readSession(
      await issueSession({ roles: ["student", "professor", "admin"] }),
    );
    const body = (await response.json()) as {
      user: { roles: string[] };
    };
    const rotatedToken = sessionTokenFrom(sessionCookieHeaders(response));
    const rotatedClaims = await decode({
      salt: secureCookie.name,
      secret: SESSION_SECRET,
      token: rotatedToken,
    });

    expect(body.user.roles).toEqual(["student"]);
    expect(rotatedClaims?.roles).toEqual(["student"]);
    expect(JSON.stringify(body)).not.toMatch(/professor|admin/);
  });

  it("revalidates and rotates a current session without extending its absolute expiry", async () => {
    const sessionStartedAt = epochSeconds() - 60 * 60;
    const originalToken = await issueSession({ sessionStartedAt });
    mocks.getApplicationUserAccess.mockResolvedValue(
      activeAccount({ roles: ["student", "professor"] }),
    );

    const response = await readSession(originalToken);
    const body = (await response.json()) as {
      expires: string;
      user: Record<string, unknown>;
    };
    const cookieHeaders = sessionCookieHeaders(response);
    const rotatedToken = sessionTokenFrom(cookieHeaders);
    const rotatedClaims = await decode({
      salt: secureCookie.name,
      secret: SESSION_SECRET,
      token: rotatedToken,
    });

    expect(body).toEqual({
      expires: new Date(
        (sessionStartedAt + AUTH_SESSION_MAX_AGE_SECONDS) * 1_000,
      ).toISOString(),
      user: {
        appUserId: "user:student",
        authMode: "oidc",
        roles: ["student", "professor"],
        sessionVersion: 1,
      },
    });
    expect(rotatedToken).not.toBe(originalToken);
    expect(rotatedClaims).toMatchObject({
      appUserId: "user:student",
      sessionStartedAt,
      sessionVersion: 1,
    });
    expect(cookieHeaders.join("\n")).toMatch(/HttpOnly/i);
    expect(cookieHeaders.join("\n")).toMatch(/Secure/i);
    expect(cookieHeaders.join("\n")).toMatch(/SameSite=Lax/i);
    expect(cookieHeaders.join("\n")).toMatch(/Path=\//i);
    expect(cookieHeaders.join("\n")).toContain(
      `Max-Age=${AUTH_SESSION_MAX_AGE_SECONDS}`,
    );
    expect(JSON.stringify(body)).not.toContain(originalToken);
    expect(response.headers.get("location")).toBeNull();
  });

  it("invalidates the database session version when an OIDC user logs out", async () => {
    const token = await issueSession();
    const csrfResponse = await Auth(
      new Request("https://preview.example.edu/api/auth/csrf"),
      authConfig,
    );
    const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };
    const csrfCookie = csrfResponse.headers
      .getSetCookie()
      .find((header) => header.startsWith("__Host-authjs.csrf-token="))
      ?.split(";", 1)[0];
    expect(csrfCookie).toBeDefined();

    const form = new URLSearchParams({ callbackUrl: "/", csrfToken });
    const response = await Auth(
      new Request("https://preview.example.edu/api/auth/signout", {
        body: form,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          cookie: `${csrfCookie}; ${secureCookie.name}=${encodeURIComponent(token)}`,
        },
        method: "POST",
      }),
      authConfig,
    );

    expect(mocks.invalidateApplicationSessionOnLogout).toHaveBeenCalledWith({
      sessionVersion: 1,
      userId: "user:student",
    });
    expect(sessionCookieHeaders(response).join("\n")).toContain("Max-Age=0");
    expect(response.headers.get("location")).toBe(
      "https://preview.example.edu/",
    );
    expect(response.headers.get("location")).not.toContain(token);
  });
});

describe("browser authentication data", () => {
  it("does not log authentication data from client authentication modules", async () => {
    const sources = await Promise.all(
      [
        "src/components/auth/anonymous-import-panel.tsx",
        "src/components/auth/current-page-sign-in-link.tsx",
      ].map((path) => readFile(path, "utf8")),
    );

    expect(sources.join("\n")).not.toMatch(
      /console\.(?:debug|error|info|log|warn)/,
    );
  });
});

function activeAccount(
  overrides: Partial<{
    roles: ("student" | "professor" | "admin")[];
    sessionVersion: number;
    status: "active" | "deleted" | "disabled" | "invited";
  }> = {},
) {
  return {
    displayName: "Student",
    email: "student@example.edu",
    id: "user:student",
    roles: overrides.roles ?? ["student"],
    sessionVersion: overrides.sessionVersion ?? 1,
    status: overrides.status ?? ("active" as const),
  };
}

async function issueSession(
  overrides: Partial<{
    appUserId: string;
    authMode: "oidc" | "test";
    roles: ("student" | "professor" | "admin")[];
    sessionStartedAt: number;
    sessionVersion: number;
    sub: string;
  }> = {},
  maxAge = AUTH_SESSION_MAX_AGE_SECONDS,
) {
  const appUserId = overrides.appUserId ?? "user:student";
  return encode({
    maxAge,
    salt: secureCookie.name,
    secret: SESSION_SECRET,
    token: {
      appUserId,
      authMode: overrides.authMode ?? "oidc",
      roles: overrides.roles ?? ["student"],
      sessionStartedAt: overrides.sessionStartedAt ?? epochSeconds(),
      sessionVersion: overrides.sessionVersion ?? 1,
      sub: overrides.sub ?? appUserId,
    },
  });
}

function readSession(token?: string) {
  return Auth(
    new Request("https://preview.example.edu/api/auth/session", {
      headers: token
        ? { cookie: `${secureCookie.name}=${encodeURIComponent(token)}` }
        : undefined,
    }),
    authConfig,
  );
}

function sessionCookieHeaders(response: Response) {
  return response.headers
    .getSetCookie()
    .filter((header) => header.startsWith(`${secureCookie.name}=`));
}

function sessionTokenFrom(headers: string[]) {
  const value = headers[0]?.split(";", 1)[0]?.split("=", 2)[1];
  if (!value) {
    throw new Error("Expected a refreshed session cookie.");
  }
  return decodeURIComponent(value);
}
