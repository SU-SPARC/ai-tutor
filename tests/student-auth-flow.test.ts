import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerEnv: vi.fn(),
  readAnonymousCookieSubject: vi.fn(),
  redirect: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  resolveAuthenticatedPrincipal: vi.fn(),
  searchParams: new URLSearchParams("questionId=dice-sum-eight"),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  usePathname: () => "/practice",
  useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }),
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/auth", () => ({
  INSTITUTIONAL_PROVIDER_ID: "institutional-oidc",
  LOCAL_TEST_PROVIDER_ID: "local-test-identity",
  signIn: mocks.signIn,
  signOut: mocks.signOut,
}));

vi.mock("@/lib/auth/principal", () => ({
  resolveAuthenticatedPrincipal: mocks.resolveAuthenticatedPrincipal,
}));

vi.mock("@/lib/auth/anonymous-session", () => ({
  readAnonymousCookieSubject: mocks.readAnonymousCookieSubject,
}));

vi.mock("@/lib/env/server", () => ({
  getServerEnv: mocks.getServerEnv,
}));

import AccountPage from "@/app/account/page";
import { signOutAction } from "@/app/auth-actions";
import OnboardingPage from "@/app/onboarding/page";
import {
  signInWithSchoolAccount,
  signInWithTestAccount,
} from "@/app/sign-in/actions";
import SignInPage from "@/app/sign-in/page";
import { AccountActions } from "@/components/auth/account-actions";
import { AnonymousImportPanel } from "@/components/auth/anonymous-import-panel";
import { CurrentPageSignInLink } from "@/components/auth/current-page-sign-in-link";
import { authenticationErrorMessage } from "@/lib/auth/authentication-errors";
import {
  DEFAULT_STUDENT_RETURN_PATH,
  onboardingPath,
  safeReturnPath,
  signInPath,
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
  roles: ["student"] as const,
  userId: "user:test-student",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getServerEnv.mockReturnValue({
    AUTH_ENABLED: false,
    AUTH_OIDC_ENABLED: false,
    AUTH_TEST_MODE: false,
    LEGACY_ANONYMOUS_MIGRATION_ENABLED: false,
  });
  mocks.resolveAuthenticatedPrincipal.mockResolvedValue(undefined);
  mocks.readAnonymousCookieSubject.mockResolvedValue(undefined);
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
    expect(onboardingPath(requested)).toBe(
      "/onboarding?returnTo=%2Fpractice%3FquestionId%3Ddice-sum-eight%23answer",
    );
  });

  it.each([
    "https://attacker.example/steal",
    "//attacker.example/steal",
    "/\\attacker.example/steal",
    "/sign-in?callbackUrl=/practice",
    "/onboarding?returnTo=/practice",
    "/api/auth/callback/institutional-oidc",
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

describe("student sign-in routes", () => {
  it("renders an accessible school-account sign-in without technical details", async () => {
    mocks.getServerEnv.mockReturnValue({
      AUTH_ENABLED: true,
      AUTH_OIDC_ENABLED: true,
      AUTH_TEST_MODE: false,
      LEGACY_ANONYMOUS_MIGRATION_ENABLED: false,
    });

    const element = await SignInPage({
      searchParams: Promise.resolve({ callbackUrl: "/dashboard" }),
    });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain("<h1");
    expect(markup).toContain("Sign in to save your progress");
    expect(markup).toContain('type="submit"');
    expect(markup).toContain("Continue with your school account");
    expect(markup).toContain("does not collect a password");
    expect(markup).not.toMatch(/issuer|client id|client secret|OIDC|roles/i);
  });

  it("continues successful sign-in through onboarding with a safe return", async () => {
    await signInWithSchoolAccount("/practice?questionId=dice-sum-eight#answer");

    expect(mocks.signIn).toHaveBeenCalledWith("institutional-oidc", {
      redirectTo:
        "/onboarding?returnTo=%2Fpractice%3FquestionId%3Ddice-sum-eight%23answer",
    });

    const testForm = new FormData();
    testForm.set("identity", "student");
    await signInWithTestAccount("https://attacker.example/steal", testForm);

    expect(testForm.get("redirectTo")).toBe(
      "/onboarding?returnTo=%2Fdashboard",
    );
    expect(mocks.signIn).toHaveBeenLastCalledWith(
      "local-test-identity",
      testForm,
    );
  });

  it("returns instructor sign-in directly to the protected workspace", async () => {
    await signInWithSchoolAccount("/professor?section=review");

    expect(mocks.signIn).toHaveBeenCalledWith("institutional-oidc", {
      redirectTo: "/professor?section=review",
    });
  });

  it("renders a clear, sanitized and accessible authentication error", async () => {
    const element = await SignInPage({
      searchParams: Promise.resolve({
        callbackUrl: "/practice?questionId=dice-sum-eight",
        error: "IdentityConflict",
      }),
    });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("We couldn&#x27;t sign you in.");
    expect(markup).toContain("No accounts or progress were linked.");
    expect(markup).not.toContain("IdentityConflict");
    expect(markup).not.toMatch(/issuer|client secret|OIDC|application roles/i);
  });

  it("redirects an existing session only to a normalized safe page", async () => {
    mocks.resolveAuthenticatedPrincipal.mockResolvedValue(student);

    await expect(
      SignInPage({
        searchParams: Promise.resolve({
          callbackUrl: "https://attacker.example/steal",
        }),
      }),
    ).rejects.toMatchObject({ destination: DEFAULT_STUDENT_RETURN_PATH });
  });

  it("maps unknown authentication failures without exposing their code", () => {
    expect(authenticationErrorMessage("InternalProviderFailure")).toBe(
      "Sign-in could not be completed. Please try again or contact application support.",
    );
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

  it("shows only the minimal profile and explicit migration choices", async () => {
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
    expect(markup).toContain("Import recent practice");
    expect(markup).toContain("Continue without importing");
    expect(markup).toContain(
      "Nothing is imported until you choose an import button.",
    );
    expect(markup).not.toMatch(
      /application roles|identity provider|OIDC|issuer/i,
    );
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
    expect(markup).not.toMatch(/application roles|student,|identity provider/i);
  });
});

describe("session-aware authentication components", () => {
  it("offers migration and a separate continue choice without auto-submitting", () => {
    const markup = renderToStaticMarkup(
      createElement(AnonymousImportPanel, {
        continueTo: "/dashboard",
        hasSignedBrowserIdentity: true,
        legacyBridgeEnabled: false,
      }),
    );

    expect(markup).toContain('type="button"');
    expect(markup).toContain("Import recent practice");
    expect(markup).toContain("Continue without importing");
    expect(markup).not.toContain("legacyAnonymousId");
  });

  it("builds the sign-in link from the current safe page", () => {
    const markup = renderToStaticMarkup(createElement(CurrentPageSignInLink));

    expect(markup).toContain(
      'href="/sign-in?callbackUrl=%2Fpractice%3FquestionId%3Ddice-sum-eight"',
    );
  });

  it("shows account and sign-out controls without exposing student roles", async () => {
    mocks.resolveAuthenticatedPrincipal.mockResolvedValue(student);
    const element = await AccountActions();
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain('href="/account"');
    expect(markup).toContain("Sign out");
    expect(markup).not.toContain("Instructor tools");
    expect(markup).not.toMatch(/student|oidc|provider/i);
  });

  it("signs out through the server action and returns home", async () => {
    await signOutAction();

    expect(mocks.signOut).toHaveBeenCalledWith({ redirectTo: "/" });
  });
});
