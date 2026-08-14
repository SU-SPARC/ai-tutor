import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acknowledgeStudentOnboarding: vi.fn(),
  clearAnonymousSession: vi.fn(),
  getServerEnv: vi.fn(),
  hasAcknowledgedStudentOnboarding: vi.fn(),
  readAnonymousCookieSubject: vi.fn(),
  redirect: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  resolveAuthenticatedPrincipal: vi.fn(),
  searchParams: new URLSearchParams("questionId=dice-sum-eight"),
  signInProps: undefined as Record<string, unknown> | undefined,
  signUpProps: undefined as Record<string, unknown> | undefined,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  usePathname: () => "/practice",
  useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }),
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@clerk/nextjs", async () => {
  const { createElement: element } = await import("react");
  return {
    SignIn: (props: Record<string, unknown>) => {
      mocks.signInProps = props;
      return element("div", { "data-clerk-sign-in": true }, "Clerk sign in");
    },
    SignOutButton: ({
      children,
      redirectUrl,
    }: {
      children: ReactNode;
      redirectUrl?: string;
    }) => element("span", { "data-sign-out-redirect": redirectUrl }, children),
    SignUp: (props: Record<string, unknown>) => {
      mocks.signUpProps = props;
      return element("div", { "data-clerk-sign-up": true }, "Clerk sign up");
    },
  };
});

vi.mock("@/lib/auth/principal", () => ({
  resolveAuthenticatedPrincipal: mocks.resolveAuthenticatedPrincipal,
}));

vi.mock("@/lib/auth/anonymous-session", () => ({
  clearAnonymousSession: mocks.clearAnonymousSession,
  readAnonymousCookieSubject: mocks.readAnonymousCookieSubject,
}));

vi.mock("@/lib/data/student-onboarding-repository", () => ({
  acknowledgeStudentOnboarding: mocks.acknowledgeStudentOnboarding,
  hasAcknowledgedStudentOnboarding: mocks.hasAcknowledgedStudentOnboarding,
}));

vi.mock("@/lib/env/server", () => ({
  getServerEnv: mocks.getServerEnv,
}));

import AccountPage from "@/app/account/page";
import { acknowledgeStudentOnboardingAction } from "@/app/onboarding/actions";
import OnboardingPage from "@/app/onboarding/page";
import SignInPage from "@/app/sign-in/[[...sign-in]]/page";
import SignUpPage from "@/app/sign-up/[[...sign-up]]/page";
import { AccountActions } from "@/components/auth/account-actions";
import { AnonymousImportPanel } from "@/components/auth/anonymous-import-panel";
import { CurrentPageSignInLink } from "@/components/auth/current-page-sign-in-link";
import {
  DEFAULT_STUDENT_RETURN_PATH,
  onboardingPath,
  safeReturnPath,
  signInPath,
  signUpPath,
} from "@/lib/auth/return-path";

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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signInProps = undefined;
  mocks.signUpProps = undefined;
  mocks.getServerEnv.mockReturnValue({
    CLERK_ENABLED: false,
    LEGACY_ANONYMOUS_MIGRATION_ENABLED: false,
  });
  mocks.resolveAuthenticatedPrincipal.mockResolvedValue(undefined);
  mocks.readAnonymousCookieSubject.mockResolvedValue(undefined);
  mocks.hasAcknowledgedStudentOnboarding.mockResolvedValue(false);
  mocks.redirect.mockImplementation((destination: string) => {
    throw new RedirectSignal(destination);
  });
});

describe("safe authentication return paths", () => {
  it("preserves an internal path, query, and fragment", () => {
    const requested = "/practice?questionId=dice-sum-eight#answer";

    expect(safeReturnPath(requested)).toBe(requested);
    expect(signInPath(requested)).toBe(
      "/sign-in?callbackUrl=%2Fpractice%3FquestionId%3Ddice-sum-eight%23answer",
    );
    expect(signUpPath(requested)).toBe(
      "/sign-up?callbackUrl=%2Fpractice%3FquestionId%3Ddice-sum-eight%23answer",
    );
    expect(onboardingPath(requested)).toBe(
      "/onboarding?returnTo=%2Fpractice%3FquestionId%3Ddice-sum-eight%23answer",
    );
  });

  it.each([
    "https://attacker.example/steal",
    "//attacker.example/steal",
    "/\\attacker.example/steal",
    "/sign-in?callbackUrl=/practice",
    "/sign-up?callbackUrl=/practice",
    "/onboarding?returnTo=/practice",
    "/api/student/progress",
    "/practice?access_token=secret",
    "/practice?sessionToken=secret",
    "/practice?session_token=secret",
    "/practice#id_token=secret",
    `/practice?value=${"x".repeat(2_100)}`,
  ])("rejects unsafe or recursive return target %s", (requested) => {
    expect(safeReturnPath(requested)).toBe(DEFAULT_STUDENT_RETURN_PATH);
  });
});

describe("student authentication routes", () => {
  it("fails safely when Clerk is not configured", async () => {
    const signIn = await SignInPage({
      searchParams: Promise.resolve({ callbackUrl: "/dashboard" }),
    });
    const signUp = await SignUpPage({
      searchParams: Promise.resolve({ callbackUrl: "/dashboard" }),
    });

    for (const element of [signIn, signUp]) {
      const markup = renderToStaticMarkup(element);
      expect(markup).toContain("Account sign-in is not configured");
      expect(markup).toContain("will not simulate a real account");
      expect(markup).not.toContain("data-clerk-sign");
    }
  });

  it("renders Clerk sign-in with a forced sanitized return path", async () => {
    mocks.getServerEnv.mockReturnValue({ CLERK_ENABLED: true });

    const element = await SignInPage({
      searchParams: Promise.resolve({
        callbackUrl: "/practice?questionId=dice-sum-eight#answer",
      }),
    });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain("data-clerk-sign-in");
    expect(mocks.signInProps).toMatchObject({
      forceRedirectUrl:
        "/onboarding?returnTo=%2Fpractice%3FquestionId%3Ddice-sum-eight%23answer",
      path: "/sign-in",
      routing: "path",
      signUpForceRedirectUrl:
        "/onboarding?returnTo=%2Fpractice%3FquestionId%3Ddice-sum-eight%23answer",
      signUpUrl:
        "/sign-up?callbackUrl=%2Fpractice%3FquestionId%3Ddice-sum-eight%23answer",
    });
  });

  it("renders Clerk sign-up and never accepts a client-selected role", async () => {
    mocks.getServerEnv.mockReturnValue({ CLERK_ENABLED: true });

    const element = await SignUpPage({
      searchParams: Promise.resolve({ callbackUrl: "/dashboard" }),
    });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain("data-clerk-sign-up");
    expect(mocks.signUpProps).toMatchObject({
      forceRedirectUrl: "/onboarding?returnTo=%2Fdashboard",
      path: "/sign-up",
      routing: "path",
      signInForceRedirectUrl: "/onboarding?returnTo=%2Fdashboard",
      signInUrl: "/sign-in?callbackUrl=%2Fdashboard",
    });
    expect(JSON.stringify(mocks.signUpProps)).not.toMatch(/role|metadata/i);
  });

  it("forces an unsafe callback to the student dashboard", async () => {
    mocks.getServerEnv.mockReturnValue({ CLERK_ENABLED: true });

    const element = await SignInPage({
      searchParams: Promise.resolve({
        callbackUrl: "https://attacker.example/steal",
      }),
    });
    renderToStaticMarkup(element);

    expect(mocks.signInProps).toMatchObject({
      forceRedirectUrl: "/onboarding?returnTo=%2Fdashboard",
    });
  });

  it("redirects an existing session only to a normalized safe page", async () => {
    mocks.getServerEnv.mockReturnValue({ CLERK_ENABLED: true });
    mocks.resolveAuthenticatedPrincipal.mockResolvedValue(student);

    await expect(
      SignInPage({
        searchParams: Promise.resolve({
          callbackUrl: "https://attacker.example/steal",
        }),
      }),
    ).rejects.toMatchObject({ destination: DEFAULT_STUDENT_RETURN_PATH });
  });
});

describe("student onboarding and account routes", () => {
  it("requires a session and keeps the requested page through sign-in", async () => {
    await expect(
      OnboardingPage({
        searchParams: Promise.resolve({
          returnTo: "/practice?questionId=dice-sum-eight",
        }),
      }),
    ).rejects.toMatchObject({
      destination:
        "/sign-in?callbackUrl=%2Fpractice%3FquestionId%3Ddice-sum-eight",
    });
  });

  it("shows the complete data notice and explicit migration choices", async () => {
    mocks.resolveAuthenticatedPrincipal.mockResolvedValue(student);
    mocks.readAnonymousCookieSubject.mockResolvedValue(
      "anon:11111111-1111-4111-8111-111111111111",
    );

    const element = await OnboardingPage({
      searchParams: Promise.resolve({ returnTo: "/dashboard" }),
    });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain("Test Student");
    expect(markup).toContain("student@example.invalid");
    expect(markup).toContain("does not replace your professor");
    expect(markup).toContain("Activity that is saved");
    expect(markup).toContain("short answer preview");
    expect(markup).toContain("Optional AI fallback");
    expect(markup).toContain(
      "Generated explanations can be incomplete or wrong",
    );
    expect(markup).toContain("To report an error");
    expect(markup).toContain("Pilot limits, errors, and support");
    expect(markup).toContain("Account → Tutor and data notice");
    expect(markup).toContain(
      "stores only the date and time that you acknowledged",
    );
    expect(markup).toContain("Import recent practice");
    expect(markup).toContain("continue without importing");
    expect(markup).toContain(
      "Nothing is imported until you choose an import button.",
    );
    expect(markup).toContain("does not receive or store your password");
    expect(markup).not.toMatch(/application roles|issuer/i);
    expect(markup).not.toMatch(/university approved|approved by suffolk/i);
  });

  it("skips completed onboarding unless the student asks to review it", async () => {
    mocks.resolveAuthenticatedPrincipal.mockResolvedValue(student);
    mocks.hasAcknowledgedStudentOnboarding.mockResolvedValue(true);

    await expect(
      OnboardingPage({
        searchParams: Promise.resolve({ returnTo: "/dashboard" }),
      }),
    ).rejects.toMatchObject({ destination: "/dashboard" });

    const review = await OnboardingPage({
      searchParams: Promise.resolve({
        returnTo: "/account",
        review: "1",
      }),
    });
    const markup = renderToStaticMarkup(review);

    expect(markup).toContain("Tutor and data notice");
    expect(markup).toContain("Back to your account");
    expect(markup).not.toContain("stores only the date and time");
  });

  it("acknowledges once, leaves browser practice separate, and continues safely", async () => {
    mocks.resolveAuthenticatedPrincipal.mockResolvedValue(student);
    mocks.acknowledgeStudentOnboarding.mockResolvedValue(undefined);
    mocks.clearAnonymousSession.mockResolvedValue(undefined);

    await expect(
      acknowledgeStudentOnboardingAction("https://attacker.example/steal", {}),
    ).rejects.toMatchObject({ destination: "/dashboard" });

    expect(mocks.acknowledgeStudentOnboarding).toHaveBeenCalledOnce();
    expect(mocks.acknowledgeStudentOnboarding).toHaveBeenCalledWith(
      "user:test-student",
    );
    expect(mocks.clearAnonymousSession).toHaveBeenCalledOnce();
  });

  it("keeps the student on the notice when acknowledgement storage fails", async () => {
    mocks.resolveAuthenticatedPrincipal.mockResolvedValue(student);
    mocks.acknowledgeStudentOnboarding.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await expect(
      acknowledgeStudentOnboardingAction("/practice", {}),
    ).resolves.toEqual({
      error:
        "Your acknowledgement could not be saved. Please try again before continuing.",
    });
    expect(mocks.clearAnonymousSession).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("protects the account route and does not render role details", async () => {
    await expect(AccountPage()).rejects.toMatchObject({
      destination: "/sign-in?callbackUrl=%2Faccount",
    });

    mocks.resolveAuthenticatedPrincipal.mockResolvedValue(student);
    const element = await AccountPage();
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain("Test Student");
    expect(markup).toContain("student@example.invalid");
    expect(markup).toContain("Tutor and data notice");
    expect(markup).not.toMatch(/application roles|student,|identity provider/i);
  });
});

describe("session-aware authentication components", () => {
  it("offers migration and a separate continue choice without auto-submitting", () => {
    const markup = renderToStaticMarkup(
      createElement(AnonymousImportPanel, {
        continueAction: async () => ({}),
        hasSignedBrowserIdentity: true,
        legacyBridgeEnabled: false,
      }),
    );

    expect(markup).toContain('type="button"');
    expect(markup).toContain("Import recent practice");
    expect(markup).toContain("continue without importing");
    expect(markup).not.toContain("legacyAnonymousId");
  });

  it("builds the sign-in link from the current safe page", () => {
    const markup = renderToStaticMarkup(createElement(CurrentPageSignInLink));

    expect(markup).toContain(
      'href="/sign-in?callbackUrl=%2Fpractice%3FquestionId%3Ddice-sum-eight"',
    );
  });

  it("shows account and Clerk sign-out controls without exposing roles", async () => {
    mocks.resolveAuthenticatedPrincipal.mockResolvedValue(student);
    const element = await AccountActions();
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain('href="/account"');
    expect(markup).toContain("Sign out");
    expect(markup).toContain('data-sign-out-redirect="/"');
    expect(markup).not.toContain("Instructor tools");
    expect(markup).not.toMatch(/student|oidc|provider/i);
  });
});
