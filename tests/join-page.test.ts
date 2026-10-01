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
import {
  parseSectionCode,
  SECTION_CODE_ERROR,
  SECTION_CODE_UNKNOWN_ERROR,
  sectionCodeProblem,
} from "@/components/auth/join-screen";
import {
  isKnownSectionCode,
  sectionLabelForCode,
  UNJOINED_SECTION_LABEL,
} from "@/components/shell/use-student-section";

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
  // renderToStaticMarkup escapes apostrophes; assertions read plain text.
  return renderToStaticMarkup(
    await JoinPage({ searchParams: Promise.resolve({ callbackUrl }) }),
  ).replaceAll("&#x27;", "'");
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
    // The demo has no SSO: one caption says so instead of a disabled button.
    expect(markup).not.toContain("Continue with Suffolk (SSO)");
    expect(markup).toContain("Suffolk sign-in isn't available in this demo.");
    expect(markup).toContain("Continue as guest");
    expect(markup).toContain("Section code");
    expect(markup).toContain('placeholder="K7Q-2M"');
    expect(markup).toContain("Join</button>");
    expect(markup).toContain("Teaching MATH-255?");
    expect(markup).toContain("Professor sign-in");
    expect(markup).not.toContain("Professor demo sign-in");
    expect(markup).toContain('id="professor"');
  });

  it("heads the sheet with the logo and wordmark, above the one h1", async () => {
    const markup = await renderJoin();

    expect(markup).toContain('data-slot="logo"');
    expect(markup).toContain("AI Tutor");
    expect(markup.indexOf('data-slot="logo"')).toBeLessThan(
      markup.indexOf("Join MATH-255"),
    );
    expect(markup.match(/<h1/g)).toHaveLength(1);
  });

  it("has one guest door, not a second unnamed Continue button", async () => {
    const markup = await renderJoin();

    expect(markup.match(/Continue as guest/g)).toHaveLength(1);
    expect(markup).not.toContain("Continue →");
  });

  it("leads with the section code in the demo and with SSO once it is configured", async () => {
    const demo = await renderJoin();
    expect(demo.indexOf("Section code")).toBeLessThan(
      demo.indexOf("Suffolk sign-in isn't available in this demo."),
    );

    mocks.getServerEnv.mockReturnValue({
      ANONYMOUS_PILOT_ENABLED: true,
      CLERK_ENABLED: true,
      GHOST_LOGIN_ENABLED: false,
    });
    const configured = await renderJoin();
    expect(configured.indexOf("Continue with Suffolk (SSO)")).toBeLessThan(
      configured.indexOf("Section code"),
    );
  });

  it("accepts a section code in any case or spacing and refuses anything else", () => {
    expect(parseSectionCode("K7Q-2M")).toBe("K7Q-2M");
    expect(parseSectionCode("k7q2m")).toBe("K7Q-2M");
    expect(parseSectionCode(" r4n 8x ")).toBe("R4N-8X");
    expect(parseSectionCode("")).toBeNull();
    expect(parseSectionCode("K7Q")).toBeNull();
    expect(parseSectionCode("K7Q-2MX")).toBeNull();
    expect(SECTION_CODE_ERROR).toBe(
      "Enter the code from your professor, like K7Q-2M.",
    );
  });

  it("refuses a well-formed code that is not one of the course's sections", () => {
    expect(sectionCodeProblem("k7q2m")).toBeNull();
    expect(sectionCodeProblem("R4N-8X")).toBeNull();
    expect(sectionCodeProblem("K7Q")).toBe(SECTION_CODE_ERROR);
    expect(sectionCodeProblem("ABC-DE")).toBe(SECTION_CODE_UNKNOWN_ERROR);
    expect(SECTION_CODE_UNKNOWN_ERROR).toBe(
      "We don't recognise that code. Check it with your professor.",
    );
    expect(isKnownSectionCode("abc-de")).toBe(false);
  });

  it("names sections the way students say them, and a guest as a guest", () => {
    expect(sectionLabelForCode("k7q-2m")).toBe("MATH-255 · Section 1");
    expect(sectionLabelForCode("R4N-8X")).toBe("MATH-255 · Section 2");
    expect(sectionLabelForCode("ABC-DE")).toBe(UNJOINED_SECTION_LABEL);
    expect(UNJOINED_SECTION_LABEL).toBe("MATH-255 · Guest");
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
    expect(markup).not.toContain("isn't available in this demo");
    // Guest practice is still open, so the guest door is a plain link.
    expect(markup).toContain('href="/practice"');
    expect(markup).not.toContain("Professor sign-in");
  });

  it("states what is kept, under whose name, and where guest progress lives", async () => {
    const markup = await renderJoin();

    expect(markup).toContain("What we keep:");
    expect(markup).toContain(
      "your attempts, hints, answers, and how often you ask the AI tutor.",
    );
    expect(markup).toContain(
      "Your professor sees you as a code (like Student 8F2A); your name is shown only if they open your record, and that is logged. Your professor also sees how many times you asked the AI tutor, not what you wrote.",
    );
    // Sketchpad time is not measured by default, so it is not mentioned.
    expect(markup).not.toContain("sketchpad");
    expect(markup).not.toContain("hashed key");
    expect(markup).not.toContain("never your name");
    // The demo has no sign-in to keep guest progress with, so none is promised.
    expect(markup).toContain(
      "As a guest, your progress lives in this browser.",
    );
    expect(markup).not.toContain("import it");
  });

  it("adds sketchpad time to the join note once it is measured", async () => {
    mocks.getServerEnv.mockReturnValue({
      ...DEMO_ENV,
      SKETCHPAD_ACTIVE_TIME_MEASUREMENT_ENABLED: true,
    });

    const markup = await renderJoin();

    expect(markup).toContain(
      "Your professor also sees how many times you asked the AI tutor and about how long you spent on the sketchpad, not what you wrote or drew.",
    );
    expect(markup).not.toContain("not what you wrote.");
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

  it("gives a signed-in student the code form when they come to change section", async () => {
    mocks.resolveAuthenticatedPrincipal.mockResolvedValue(student);

    const markup = await renderJoin();

    expect(markup).toContain("Join your section");
    expect(markup).toContain("Section code");
    expect(markup).toContain("Join</button>");
    expect(markup).toContain('href="/learn"');
    expect(markup).toContain("Back to Learn");
    expect(markup).not.toContain("Continue as guest");
    expect(markup).not.toContain("Suffolk");
    expect(markup.match(/<h1/g)).toHaveLength(1);
  });

  it("still sends a signed-in professor on to Learn", async () => {
    mocks.resolveAuthenticatedPrincipal.mockResolvedValue({
      ...student,
      role: "professor" as const,
      roles: ["student", "professor"] as const,
    });

    await expect(renderJoin()).rejects.toMatchObject({ destination: "/learn" });
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
