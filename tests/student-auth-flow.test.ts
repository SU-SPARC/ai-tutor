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

const FEEDBACK_ENV = {
  FEEDBACK_CONTACT_NAME: "Professor Example",
  FEEDBACK_EMAIL: "feedback@example.invalid",
};

const FEEDBACK_HREF =
  'href="mailto:feedback@example.invalid?subject=AI%20Tutor%20feedback"';

/** The account page reads the feedback contact from validated server env. */
function withFeedbackEnv() {
  mocks.getServerEnv.mockReturnValue({
    CLERK_ENABLED: false,
    LEGACY_ANONYMOUS_MIGRATION_ENABLED: false,
    ...FEEDBACK_ENV,
  });
}

const PRIVACY_SENTENCE =
  "Your professor sees you as a code (like Student 8F2A); your name is shown only if they open your record, and that is logged.";

/** The usage disclosure while sketchpad time is not measured (the default). */
const USAGE_SENTENCE =
  "Your professor also sees how many times you asked the AI tutor, not what you wrote.";

/** The same disclosure once sketchpad measurement is switched on. */
const USAGE_SENTENCE_WITH_SKETCHPAD =
  "Your professor also sees how many times you asked the AI tutor and about how long you spent on the sketchpad, not what you wrote or drew.";

/** renderToStaticMarkup escapes apostrophes; assertions read plain text. */
function plain(markup: string) {
  return markup.replaceAll("&#x27;", "'");
}

class RedirectSignal extends Error {
  constructor(readonly destination: string) {
    super(`Redirected to ${destination}`);
  }
}

const guest = {
  displayName: "Guest",
  email: "ghost-student@example.invalid",
  kind: "user" as const,
  role: "student" as const,
  roles: ["student"] as const,
  userId: "ghost:student",
};

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
  it("fails safely when neither Clerk nor the demo sign-in is configured", async () => {
    const signIn = await SignInPage({
      searchParams: Promise.resolve({ callbackUrl: "/dashboard" }),
    });
    const signUp = await SignUpPage({
      searchParams: Promise.resolve({ callbackUrl: "/dashboard" }),
    });

    for (const element of [signIn, signUp]) {
      const markup = plain(renderToStaticMarkup(element));
      expect(markup).toContain("Sign-in isn't set up here");
      expect(markup).toContain(
        "You can still practice as a guest; progress stays in this browser.",
      );
      expect(markup).toContain('href="/"');
      expect(markup).toContain("Go to the home page");
      expect(markup).not.toMatch(/clerk|credentials|anonymous/i);
      expect(markup).not.toContain("data-clerk-sign");
    }
  });

  it("sends both demo entry points to the one join screen, keeping the requested page", async () => {
    mocks.getServerEnv.mockReturnValue({
      CLERK_ENABLED: false,
      GHOST_LOGIN_ENABLED: true,
      LEGACY_ANONYMOUS_MIGRATION_ENABLED: false,
    });

    for (const page of [SignInPage, SignUpPage]) {
      await expect(
        page({
          searchParams: Promise.resolve({
            callbackUrl: "/practice?questionId=dice-sum-eight",
          }),
        }),
      ).rejects.toMatchObject({
        destination:
          "/join?callbackUrl=%2Fpractice%3FquestionId%3Ddice-sum-eight",
      });

      await expect(
        page({ searchParams: Promise.resolve({}) }),
      ).rejects.toMatchObject({ destination: "/join" });
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

  it("forces an unsafe callback to the learn page", async () => {
    mocks.getServerEnv.mockReturnValue({ CLERK_ENABLED: true });

    const element = await SignInPage({
      searchParams: Promise.resolve({
        callbackUrl: "https://attacker.example/steal",
      }),
    });
    renderToStaticMarkup(element);

    expect(mocks.signInProps).toMatchObject({
      forceRedirectUrl: "/onboarding?returnTo=%2Flearn",
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
    const markup = plain(renderToStaticMarkup(element));

    // One breath: the heading, one paragraph, the choice, then the details.
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toContain("Before you start");
    expect(markup).toContain(
      "We save your attempts, hints and answers so you can pick up where you left off.",
    );
    expect(markup).toContain(PRIVACY_SENTENCE);
    expect(markup).toContain(`${PRIVACY_SENTENCE} ${USAGE_SENTENCE}`);
    expect(markup).not.toContain("sketchpad");
    expect(markup).toContain("AI help is optional and can be wrong.");
    expect(markup).not.toMatch(/never your name|hashed key|pseudonymous/i);
    expect(markup).toContain("<details");
    expect(markup).toContain("Read the full notice");
    expect(markup.indexOf("Bring it over")).toBeLessThan(
      markup.indexOf("Read the full notice"),
    );

    expect(markup).toContain("Test Student");
    expect(markup).toContain("student@example.invalid");
    expect(markup).toContain("does not replace your professor");
    expect(markup).toContain("Activity that is saved");
    expect(markup).toContain("short answer preview");
    expect(markup).toContain("Optional AI help");
    expect(markup).toContain("how many times you used Ask AI for help");
    expect(markup).toContain(
      "Your professor sees how many times you asked, not your messages.",
    );
    expect(markup).not.toContain("limited usage counts");
    expect(markup).not.toContain("AI usage and responses may also be recorded");
    expect(markup).not.toMatch(/fallback|provider/i);
    expect(markup).toContain("Explanations can be incomplete or wrong");
    expect(markup).toContain("To report an error");
    expect(markup).toContain("Pilot limits, errors, and support");
    expect(markup).toContain("Your account → Read the data notice");
    expect(markup).not.toContain(
      "stores only the date and time that you acknowledged",
    );
    expect(markup).toContain("Bring over your guest practice?");
    expect(markup).toContain("Bring it over");
    expect(markup).toContain("Start fresh (don't bring it over)");
    expect(markup).toContain(
      "If you start fresh, the practice saved in this browser is removed.",
    );
    expect(markup).toContain(
      "Bring it into your account only if this is your own computer.",
    );
    expect(markup).not.toMatch(/browser profile|Clerk/);
    expect(markup).toContain("does not receive or store your password");
    expect(markup).not.toMatch(/application roles|issuer/i);
    expect(markup).not.toMatch(/university approved|approved by suffolk/i);
  });

  it("tells the student about sketchpad time exactly when it is measured", async () => {
    mocks.getServerEnv.mockReturnValue({
      CLERK_ENABLED: false,
      LEGACY_ANONYMOUS_MIGRATION_ENABLED: false,
      SKETCHPAD_ACTIVE_TIME_MEASUREMENT_ENABLED: true,
    });
    mocks.resolveAuthenticatedPrincipal.mockResolvedValue(student);

    const markup = plain(
      renderToStaticMarkup(
        await OnboardingPage({
          searchParams: Promise.resolve({ returnTo: "/learn" }),
        }),
      ),
    );

    expect(markup).toContain(
      `${PRIVACY_SENTENCE} ${USAGE_SENTENCE_WITH_SKETCHPAD} AI help is optional and can be wrong.`,
    );
    expect(markup).toContain(
      "Your professor sees about how long you spend on the sketchpad, not what you draw.",
    );
    expect(markup).not.toContain(USAGE_SENTENCE);
  });

  it("offers one mint button and no import panel when there is no guest practice", async () => {
    mocks.resolveAuthenticatedPrincipal.mockResolvedValue(student);

    const markup = plain(
      renderToStaticMarkup(
        await OnboardingPage({
          searchParams: Promise.resolve({ returnTo: "/learn" }),
        }),
      ),
    );

    expect(markup).toContain("Got it, start practicing");
    expect(markup.match(/[\s"]bg-mint(?=[\s"])/g)).toHaveLength(1);
    expect(markup).not.toContain("Bring over your guest practice?");
    expect(markup).not.toContain("No practice waiting");
    expect(markup).not.toContain("Start fresh");
  });

  it("shows the demo guest as a guest, with no made-up email", async () => {
    mocks.resolveAuthenticatedPrincipal.mockResolvedValue(guest);

    const markup = plain(
      renderToStaticMarkup(
        await OnboardingPage({
          searchParams: Promise.resolve({ returnTo: "/learn" }),
        }),
      ),
    );

    expect(markup).toContain("Guest (demo)");
    expect(markup).not.toContain("example.invalid");
    expect(markup).not.toMatch(/ghost/i);
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
    ).rejects.toMatchObject({ destination: "/learn" });

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
        "That didn't work and nothing changed. Try again, or reload the page.",
    });
    expect(mocks.clearAnonymousSession).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("protects the account route and does not render role details", async () => {
    await expect(AccountPage()).rejects.toMatchObject({
      destination: "/sign-in?callbackUrl=%2Faccount",
    });

    withFeedbackEnv();
    mocks.resolveAuthenticatedPrincipal.mockResolvedValue(student);
    const element = await AccountPage();
    const markup = plain(renderToStaticMarkup(element));

    expect(markup).toContain("Test Student");
    expect(markup).toContain("student@example.invalid");
    expect(markup).toContain(
      "Who you are, your section, and your saved practice.",
    );
    expect(markup).toContain(
      "Your name and email come from your Suffolk sign-in.",
    );
    expect(markup).toContain(
      "To change your password or email, use your Suffolk account. Something wrong? Ask your professor.",
    );
    expect(markup).toContain(PRIVACY_SENTENCE);
    expect(markup).toContain(`${PRIVACY_SENTENCE} ${USAGE_SENTENCE}`);
    expect(markup).not.toContain("sketchpad");
    expect(markup).toContain("Back to Learn");
    expect(markup).toContain("Sign out");
    expect(markup).toContain('data-sign-out-redirect="/"');
    expect(markup).toContain("Read the data notice");
    expect(markup).toContain("Feedback");
    expect(markup).toContain("Send all feedback to Professor Example.");
    expect(markup).toContain(FEEDBACK_HREF);
    expect(markup).toContain('rel="noreferrer"');
    expect(markup).toContain("Copy email");
    expect(markup).toContain("Onboarding guide");
    expect(markup).toContain("Tooltips that show you around");
    expect(markup).toContain('href="/learn?guide=1"');
    expect(markup).not.toMatch(/Clerk|View your progress|role issues/);
    expect(markup).not.toMatch(/application roles|student,|identity provider/i);
  });

  it("shows a demo guest one row and no account to manage", async () => {
    withFeedbackEnv();
    mocks.resolveAuthenticatedPrincipal.mockResolvedValue(guest);
    const markup = plain(renderToStaticMarkup(await AccountPage()));

    expect(markup).toContain("Guest (demo)");
    expect(markup).toContain(
      "You're practicing as a guest in a demo. There is no account to manage.",
    );
    expect(markup).toContain(`${PRIVACY_SENTENCE} ${USAGE_SENTENCE}`);
    // No made-up email for the guest; the configured feedback address is
    // the only address on the page.
    expect(markup).not.toContain(guest.email);
    expect(markup.match(/[\w.+-]+@example\.invalid/g) ?? []).toEqual([
      "feedback@example.invalid",
      "feedback@example.invalid",
    ]);
    expect(markup).not.toMatch(/Ghost|Verified email|Demo session/);
    expect(markup).toContain("Sign out");
    expect(markup).toContain("Professor Example");
    expect(markup).toContain(FEEDBACK_HREF);
  });

  it("adds sketchpad time to the account disclosure only once it is measured", async () => {
    mocks.getServerEnv.mockReturnValue({
      CLERK_ENABLED: false,
      SKETCHPAD_ACTIVE_TIME_MEASUREMENT_ENABLED: true,
    });
    mocks.resolveAuthenticatedPrincipal.mockResolvedValue(student);
    const markup = plain(renderToStaticMarkup(await AccountPage()));

    expect(markup).toContain(
      `${PRIVACY_SENTENCE} ${USAGE_SENTENCE_WITH_SKETCHPAD}`,
    );
    expect(markup).not.toContain(USAGE_SENTENCE);
  });

  it("omits the feedback row when no feedback address is configured", async () => {
    mocks.resolveAuthenticatedPrincipal.mockResolvedValue(student);
    const markup = plain(renderToStaticMarkup(await AccountPage()));

    expect(markup).toContain("Test Student");
    expect(markup).not.toContain("Feedback");
    expect(markup).not.toContain("mailto:");
    expect(markup).not.toContain("Copy email");
  });

  it("does not show the student feedback address to a professor", async () => {
    withFeedbackEnv();
    mocks.resolveAuthenticatedPrincipal.mockResolvedValue({
      ...student,
      displayName: "Test Professor",
      email: "professor@example.invalid",
      role: "professor" as const,
      roles: ["student", "professor"] as const,
      userId: "user:test-professor",
    });
    const markup = plain(renderToStaticMarkup(await AccountPage()));

    expect(markup).toContain("Professor workspace");
    expect(markup).toContain('href="/professor?guide=1"');
    expect(markup).not.toContain('href="/learn?guide=1"');
    expect(markup).not.toContain("Feedback");
    expect(markup).not.toContain("feedback@example.invalid");
    expect(markup).not.toContain("mailto:");
  });
});

describe("session-aware authentication components", () => {
  it("offers migration and a separate continue choice without auto-submitting", () => {
    const markup = plain(
      renderToStaticMarkup(
        createElement(AnonymousImportPanel, {
          continueAction: async () => ({}),
          hasSignedBrowserIdentity: true,
          legacyBridgeEnabled: false,
        }),
      ),
    );

    expect(markup).toContain('type="button"');
    expect(markup).toContain("Bring it over");
    expect(markup).toContain("Start fresh (don't bring it over)");
    expect(markup).not.toContain("legacyAnonymousId");
    // Bringing it over is the one mint while there is practice to bring.
    expect(markup.match(/[\s"]bg-mint(?=[\s"])/g)).toHaveLength(1);
  });

  it("renders nothing on the account page when there is no guest practice", () => {
    const markup = renderToStaticMarkup(
      createElement(AnonymousImportPanel, {
        hasSignedBrowserIdentity: false,
        legacyBridgeEnabled: false,
      }),
    );

    expect(markup).toBe("");
  });

  it("checks for older practice with a skeleton, never a spinner", () => {
    const markup = renderToStaticMarkup(
      createElement(AnonymousImportPanel, {
        hasSignedBrowserIdentity: false,
        legacyBridgeEnabled: true,
      }),
    );

    expect(markup).toContain('data-slot="skeleton"');
    expect(markup).toContain("Checking for guest practice…");
    expect(markup).not.toContain("animate-spin");
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
    expect(markup).toContain("Your account");
    expect(markup).toContain("Sign out");
    expect(markup).toContain('data-sign-out-redirect="/"');
    expect(markup).not.toContain("Instructor tools");
    // The menu says who you are (the display name), and nothing about roles.
    expect(markup).toContain("Test Student");
    expect(markup.replaceAll("Test Student", "")).not.toMatch(
      /student|oidc|provider/i,
    );
  });

  it("names the demo guest as a guest in the account menu", async () => {
    mocks.resolveAuthenticatedPrincipal.mockResolvedValue(guest);
    const markup = renderToStaticMarkup(await AccountActions());

    expect(markup).toContain("Guest (demo)");
    expect(markup).not.toMatch(/ghost|student/i);
  });
});
