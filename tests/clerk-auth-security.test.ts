import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  currentUser: vi.fn(),
  getApplicationUserAccessByExternalIdentity: vi.fn(),
  getServerEnv: vi.fn(),
  upsertClerkAccount: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
  currentUser: mocks.currentUser,
}));

vi.mock("@/lib/auth/account-repository", () => ({
  CLERK_IDENTITY_PROVIDER: "clerk",
  getApplicationUserAccessByExternalIdentity:
    mocks.getApplicationUserAccessByExternalIdentity,
  upsertClerkAccount: mocks.upsertClerkAccount,
}));

vi.mock("@/lib/env/server", () => ({
  getServerEnv: mocks.getServerEnv,
}));

import { resolveAuthenticatedPrincipal } from "@/lib/auth/principal";

const activeStudent = {
  displayName: "Clerk Student",
  email: "student@example.edu",
  id: "user:application-student",
  roles: ["student"],
  sessionVersion: 1,
  status: "active",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "development");
  mocks.getServerEnv.mockReturnValue({ CLERK_ENABLED: true });
  mocks.auth.mockResolvedValue({
    isAuthenticated: true,
    sessionClaims: {
      publicMetadata: { role: "admin" },
    },
    userId: "user_clerk_student",
  });
  mocks.getApplicationUserAccessByExternalIdentity.mockResolvedValue(
    activeStudent,
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Clerk identity boundary", () => {
  it("does not invoke Clerk when authentication is not configured", async () => {
    mocks.getServerEnv.mockReturnValue({ CLERK_ENABLED: false });

    await expect(resolveAuthenticatedPrincipal()).resolves.toBeUndefined();
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("returns no principal for a signed-out request", async () => {
    mocks.auth.mockResolvedValue({
      isAuthenticated: false,
      userId: null,
    });

    await expect(resolveAuthenticatedPrincipal()).resolves.toBeUndefined();
    expect(
      mocks.getApplicationUserAccessByExternalIdentity,
    ).not.toHaveBeenCalled();
  });

  it("uses only database roles and ignores client/session role metadata", async () => {
    await expect(resolveAuthenticatedPrincipal()).resolves.toEqual({
      displayName: "Clerk Student",
      email: "student@example.edu",
      kind: "user",
      roles: ["student"],
      userId: "user:application-student",
    });
    expect(
      mocks.getApplicationUserAccessByExternalIdentity,
    ).toHaveBeenCalledWith("clerk", "user_clerk_student");
    expect(mocks.currentUser).not.toHaveBeenCalled();
  });

  it("creates a student application profile from a verified primary email", async () => {
    mocks.getApplicationUserAccessByExternalIdentity.mockResolvedValue(
      undefined,
    );
    mocks.currentUser.mockResolvedValue({
      emailAddresses: [
        {
          emailAddress: "new.student@example.edu",
          id: "email_primary",
          verification: { status: "verified" },
        },
      ],
      firstName: "New",
      fullName: "New Student",
      id: "user_clerk_student",
      lastName: "Student",
      primaryEmailAddressId: "email_primary",
    });
    mocks.upsertClerkAccount.mockResolvedValue({
      ...activeStudent,
      displayName: "New Student",
      email: "new.student@example.edu",
    });

    await expect(resolveAuthenticatedPrincipal()).resolves.toMatchObject({
      roles: ["student"],
      userId: "user:application-student",
    });
    expect(mocks.upsertClerkAccount).toHaveBeenCalledWith({
      clerkUserId: "user_clerk_student",
      displayName: "New Student",
      email: "new.student@example.edu",
    });
  });

  it("rejects an unverified primary email and does not create a profile", async () => {
    mocks.getApplicationUserAccessByExternalIdentity.mockResolvedValue(
      undefined,
    );
    mocks.currentUser.mockResolvedValue({
      emailAddresses: [
        {
          emailAddress: "unverified@example.edu",
          id: "email_primary",
          verification: { status: "unverified" },
        },
      ],
      id: "user_clerk_student",
      primaryEmailAddressId: "email_primary",
    });

    await expect(resolveAuthenticatedPrincipal()).resolves.toBeUndefined();
    expect(mocks.upsertClerkAccount).not.toHaveBeenCalled();
  });

  it("fails closed for a disabled application account", async () => {
    mocks.getApplicationUserAccessByExternalIdentity.mockResolvedValue({
      ...activeStudent,
      status: "disabled",
    });

    await expect(resolveAuthenticatedPrincipal()).resolves.toBeUndefined();
  });
});
