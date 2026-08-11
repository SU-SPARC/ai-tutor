import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  currentUser: vi.fn(),
  getApplicationUserAccessByExternalIdentity: vi.fn(),
  getServerEnv: vi.fn(),
  syncClerkRoleProjection: vi.fn(),
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
  syncClerkRoleProjection: mocks.syncClerkRoleProjection,
  upsertClerkAccount: mocks.upsertClerkAccount,
}));

vi.mock("@/lib/env/server", () => ({
  getServerEnv: mocks.getServerEnv,
}));

import { resolveAuthenticatedPrincipal } from "@/lib/auth/principal";
import { applicationRoleFromPublicMetadata } from "@/lib/auth/roles";

const activeStudent = {
  displayName: "Clerk Student",
  email: "student@example.edu",
  id: "user:application-student",
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
  mocks.currentUser.mockResolvedValue(clerkUser());
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

  it("uses Clerk public metadata and ignores session/client role metadata", async () => {
    await expect(resolveAuthenticatedPrincipal()).resolves.toEqual({
      displayName: "Clerk Student",
      email: "student@example.edu",
      kind: "user",
      role: "student",
      roles: ["student"],
      userId: "user:application-student",
    });
    expect(
      mocks.getApplicationUserAccessByExternalIdentity,
    ).toHaveBeenCalledWith("clerk", "user_clerk_student");
    expect(mocks.currentUser).toHaveBeenCalledOnce();
    expect(mocks.syncClerkRoleProjection).toHaveBeenCalledWith(
      "user:application-student",
      "student",
    );
  });

  it("recognizes only the exact professor public metadata value", async () => {
    mocks.currentUser.mockResolvedValue(
      clerkUser({ publicMetadata: { role: "professor" } }),
    );

    await expect(resolveAuthenticatedPrincipal()).resolves.toMatchObject({
      role: "professor",
      roles: ["student", "professor"],
    });
  });

  it("sees a Dashboard role change on the next server request without a new session token", async () => {
    mocks.currentUser
      .mockResolvedValueOnce(clerkUser())
      .mockResolvedValueOnce(
        clerkUser({ publicMetadata: { role: "professor" } }),
      );

    const beforeRefresh = await resolveAuthenticatedPrincipal();
    const afterRefresh = await resolveAuthenticatedPrincipal();

    expect(beforeRefresh).toMatchObject({
      role: "student",
      roles: ["student"],
    });
    expect(afterRefresh).toMatchObject({
      role: "professor",
      roles: ["student", "professor"],
    });
    expect(mocks.auth).toHaveBeenCalledTimes(2);
    expect(mocks.currentUser).toHaveBeenCalledTimes(2);
  });

  it.each([
    undefined,
    null,
    {},
    { role: "admin" },
    { role: "Professor" },
    { role: ["professor"] },
  ])("defaults missing or malformed metadata to student", (metadata) => {
    expect(applicationRoleFromPublicMetadata(metadata)).toBe("student");
  });

  it("does not accept a self-writable unsafe metadata role", async () => {
    mocks.currentUser.mockResolvedValue(
      clerkUser({
        publicMetadata: {},
        unsafeMetadata: { role: "professor" },
      }),
    );

    await expect(resolveAuthenticatedPrincipal()).resolves.toMatchObject({
      role: "student",
    });
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
      publicMetadata: {},
    });
    mocks.upsertClerkAccount.mockResolvedValue({
      ...activeStudent,
      displayName: "New Student",
      email: "new.student@example.edu",
    });

    await expect(resolveAuthenticatedPrincipal()).resolves.toMatchObject({
      role: "student",
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
      publicMetadata: {},
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

function clerkUser(
  overrides: Partial<{
    publicMetadata: Record<string, unknown>;
    unsafeMetadata: Record<string, unknown>;
  }> = {},
) {
  return {
    emailAddresses: [
      {
        emailAddress: "student@example.edu",
        id: "email_primary",
        verification: { status: "verified" },
      },
    ],
    fullName: "Clerk Student",
    id: "user_clerk_student",
    primaryEmailAddressId: "email_primary",
    publicMetadata: {},
    unsafeMetadata: {},
    ...overrides,
  };
}
