import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getServerEnv: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware:
    (
      handler: (
        auth: typeof mocks.auth,
        request: NextRequest,
        event: unknown,
      ) => unknown,
    ) =>
    (request: NextRequest, event: unknown) =>
      handler(mocks.auth, request, event),
}));

vi.mock("@/lib/env/server", () => ({
  getServerEnv: mocks.getServerEnv,
}));

import proxy from "@/proxy";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getServerEnv.mockReturnValue({ CLERK_ENABLED: false });
  mocks.auth.mockResolvedValue({
    isAuthenticated: false,
    userId: null,
  });
});

describe("Clerk proxy", () => {
  it("keeps public routes available without Clerk credentials", async () => {
    const response = requireResponse(
      await proxy(
        new NextRequest("https://tutor.example.edu/practice"),
        {} as never,
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("redirects protected pages to the unavailable-safe sign-in page", async () => {
    const response = requireResponse(
      await proxy(
        new NextRequest("https://tutor.example.edu/professor?section=review"),
        {} as never,
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://tutor.example.edu/sign-in?callbackUrl=%2Fprofessor%3Fsection%3Dreview",
    );
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("requires a Clerk identity before protected page rendering", async () => {
    mocks.getServerEnv.mockReturnValue({ CLERK_ENABLED: true });

    const response = requireResponse(
      await proxy(
        new NextRequest("https://tutor.example.edu/account"),
        {} as never,
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://tutor.example.edu/sign-in?callbackUrl=%2Faccount",
    );
  });

  it("does not use Clerk metadata as a role gate", async () => {
    mocks.getServerEnv.mockReturnValue({ CLERK_ENABLED: true });
    mocks.auth.mockResolvedValue({
      isAuthenticated: true,
      sessionClaims: { publicMetadata: { role: "student" } },
      userId: "user_clerk_student",
    });

    const response = requireResponse(
      await proxy(
        new NextRequest("https://tutor.example.edu/admin/review"),
        {} as never,
      ),
    );

    expect(response.status).toBe(200);
  });
});

function requireResponse(value: unknown): Response {
  if (!(value instanceof Response)) {
    throw new Error("Expected the proxy to return a Response.");
  }
  return value;
}
