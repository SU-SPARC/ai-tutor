import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerEnv: vi.fn(),
  push: vi.fn(),
  redirect: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  resolveAuthenticatedPrincipal: vi.fn(),
  searchParams: new URLSearchParams(),
  signInAsGhost: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  usePathname: () => "/join",
  useRouter: () => ({
    push: mocks.push,
    refresh: mocks.refresh,
    replace: mocks.replace,
  }),
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/lib/auth/principal", () => ({
  resolveAuthenticatedPrincipal: mocks.resolveAuthenticatedPrincipal,
}));

vi.mock("@/lib/env/server", () => ({
  getServerEnv: mocks.getServerEnv,
}));

vi.mock("@/app/sign-in/ghost-actions", () => ({
  signInAsGhost: mocks.signInAsGhost,
}));

import { joinAsDemoProfessor, joinAsGuestStudent } from "@/app/join/actions";
import JoinPage from "@/app/join/page";

class RedirectSignal extends Error {
  constructor(readonly destination: string) {
    super(`Redirected to ${destination}`);
  }
}

const student = {
  displayName: "Test Student",
  email: "student@example.invalid",
  kind: "user" as const,
  role: "student" as const,
  roles: ["student"] as const,
  userId: "user:test-student",
};

const DEMO_ENV = {
  ANONYMOUS_PILOT_ENABLED: true,
  CLERK_ENABLED: false,
  GHOST_LOGIN_ENABLED: true,
};

function callbackFormData(value?: string) {
  const formData = new FormData();
  if (value !== undefined) {
    formData.set("callbackUrl", value);
  }
  return formData;
}

async function renderJoin(callbackUrl?: string) {
  return renderToStaticMarkup(
    await JoinPage({ searchParams: Promise.resolve({ callbackUrl }) }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getServerEnv.mockReturnValue(DEMO_ENV);
  mocks.resolveAuthenticatedPrincipal.mockResolvedValue(undefined);
  mocks.redirect.mockImplementation((destination: string) => {
    throw new RedirectSignal(destination);
  });
});

describe("join screen", () => {
  it("offers the three doors and names the demo's missing one", async () => {
    const markup = await renderJoin();

    expect(markup).toContain("Join MATH-255");
    expect(markup).toContain("Continue with Suffolk (SSO)");
    expect(markup).toContain("SSO is not configured in this demo");
    expect(markup).toContain("Continue as guest");
    expect(markup).toContain("or enter a section code");
    expect(markup).toContain("Join</button>");
    expect(markup).toContain("Continue →");
    expect(markup).toContain("Professor demo sign-in");
  });

  it("links the SSO door at Clerk once it is configured, and drops the demo doors", async () => {
    mocks.getServerEnv.mockReturnValue({
      ANONYMOUS_PILOT_ENABLED: true,
      CLERK_ENABLED: true,
      GHOST_LOGIN_ENABLED: false,
    });

    const markup = await renderJoin("/practice?questionId=dice-sum-eight");

    expect(markup).toContain(
      'href="/sign-in?callbackUrl=%2Fpractice%3FquestionId%3Ddice-sum-eight"',
    );
    expect(markup).not.toContain("SSO is not configured in this demo");
    // Guest practice is still open, so the guest door is a plain link.
    expect(markup).toContain('href="/practice"');
    expect(markup).not.toContain("Professor demo sign-in");
  });

  it("states what is kept, under whose name, and where guest progress lives", async () => {
    const markup = await renderJoin();

    expect(markup).toContain("What we keep");
    expect(markup).toContain("hashed key");
    expect(markup).toContain("never your name");
    expect(markup).toContain("Student 8F2A");
    expect(markup).toContain(
      "Guest progress lives in this browser until you sign in and import it.",
    );
  });

  it("carries the requested page through as a hidden field", async () => {
    const markup = await renderJoin("/practice?questionId=dice-sum-eight");

    expect(markup).toContain(
      'name="callbackUrl" value="/practice?questionId=dice-sum-eight"',
    );
  });

  it("sends an existing session on to the page it asked for", async () => {
    mocks.resolveAuthenticatedPrincipal.mockResolvedValue(student);

    await expect(renderJoin("/practice")).rejects.toMatchObject({
      destination: "/practice",
    });

    await expect(
      renderJoin("https://attacker.example/steal"),
    ).rejects.toMatchObject({
      destination: "/learn",
    });
  });

  it("still renders the guest door when identity storage is unreachable", async () => {
    mocks.resolveAuthenticatedPrincipal.mockRejectedValue(
      new Error("identity store unavailable"),
    );

    const markup = await renderJoin();

    expect(markup).toContain("Continue as guest");
    expect(markup).not.toContain("unavailable");
  });
});

describe("join server actions", () => {
  it("binds the role on the server and defaults a guest to the syllabus", async () => {
    await joinAsGuestStudent(callbackFormData());

    expect(mocks.signInAsGhost).toHaveBeenCalledOnce();
    const [role, formData] = mocks.signInAsGhost.mock.calls[0];
    expect(role).toBe("student");
    expect((formData as FormData).get("callbackUrl")).toBe("/learn");
  });

  it("keeps a requested page when one was asked for", async () => {
    await joinAsGuestStudent(callbackFormData("/practice?questionId=dice"));

    const [, formData] = mocks.signInAsGhost.mock.calls[0];
    expect((formData as FormData).get("callbackUrl")).toBe(
      "/practice?questionId=dice",
    );
  });

  it("uses the professor role only for the footer action", async () => {
    await joinAsDemoProfessor(callbackFormData());

    expect(mocks.signInAsGhost.mock.calls[0][0]).toBe("professor");
  });

  it("refuses to mint a demo session where real authentication exists", async () => {
    mocks.getServerEnv.mockReturnValue({
      ANONYMOUS_PILOT_ENABLED: true,
      CLERK_ENABLED: true,
      GHOST_LOGIN_ENABLED: false,
    });

    for (const action of [joinAsGuestStudent, joinAsDemoProfessor]) {
      await expect(action(callbackFormData())).rejects.toMatchObject({
        destination: "/join",
      });
    }
    expect(mocks.signInAsGhost).not.toHaveBeenCalled();
  });
});
