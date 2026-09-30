import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs", async () => {
  const { createElement: element } = await import("react");
  return {
    SignOutButton: ({ children }: { children: React.ReactNode }) =>
      element("span", null, children),
  };
});

import ForbiddenPage from "@/app/forbidden/page";
import { CoursesStoreProvider } from "@/components/courses/courses-store";
import ProfessorLayout from "@/app/professor/layout";
import { ThreeColumn } from "@/components/shell/three-column";
import ProfessorPage from "@/app/professor/page";
import { GET as getReviewQueue } from "@/app/api/professor/review/route";
import { AccountActions } from "@/components/auth/account-actions";
import { resetReviewQueueForTests } from "@/lib/data/data-store";
import {
  AuthorizationDeniedError,
  requireProfessor,
} from "@/lib/auth/authorization";
import { postSignInPath } from "@/lib/auth/return-path";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
  TEST_STUDENT,
} from "./auth-test-helpers";

describe("professor page authorization", () => {
  beforeEach(() => {
    resetReviewQueueForTests();
    vi.stubEnv("APP_DEMO_MODE", "true");
  });

  afterEach(() => {
    resetAuthMocks();
    vi.unstubAllEnvs();
  });

  it("returns anonymous visitors to sign-in with the professor path", async () => {
    mockPrincipal(undefined);

    await expectRedirect(
      ProfessorLayout({ children: createElement("p", null, "protected") }),
      "/sign-in?callbackUrl=%2Fprofessor",
    );
  });

  it("safely denies an authenticated student", async () => {
    mockPrincipal(TEST_STUDENT);

    await expectRedirect(
      ProfessorLayout({ children: createElement("p", null, "protected") }),
      "/forbidden",
    );

    const markup = renderToStaticMarkup(createElement(ForbiddenPage));
    const text = markup.replaceAll("&#x27;", "'");
    expect(text).toContain("This page is for professors");
    expect(text).toContain(
      "You're signed in as a student. Your practice is on Learn.",
    );
    expect(text).toContain("Back to Learn");
    expect(text).toContain("Your account");
    expect(text).not.toMatch(/Clerk|metadata|support team|instructor/i);
    expect(markup).not.toContain("sign out and sign in again");
    expect(markup).toContain('href="/learn"');
    expect(markup).toContain('href="/account"');
    expect(markup).not.toContain("required application role");
  });

  it("renders the workspace for an authenticated professor", async () => {
    mockPrincipal(TEST_PROFESSOR);
    const protectedChild = createElement("p", null, "protected");

    // The workspace is wrapped in the courses store so every professor page
    // and the header's course switcher read the same client state; inside it,
    // the shared ThreeColumn frame carries the workspace rail.
    const layout = await ProfessorLayout({ children: protectedChild });
    expect(layout.type).toBe(CoursesStoreProvider);
    expect(layout.props.children.type).toBe(ThreeColumn);
    expect(layout.props.children.props.children).toBe(protectedChild);

    const markup = renderToStaticMarkup(await ProfessorPage());
    expect(markup).toContain(">Home</h1>");
    expect(markup).toContain(
      "Approving a question does not show it to students. You decide when students see it.",
    );
    expect(markup).toContain("Next step");
    expect(markup).toContain("Waiting for you");
    expect(markup).toContain("How it works");
    expect(markup).toContain("Hide this");
    // The two gates Home exists to keep apart, as worded counts.
    expect(markup).toContain("approved, not yet shown to students");
    expect(markup).toContain("students can see");
    expect(markup).toContain("waiting for your review");
    // One next step: review what waits, or add a question.
    expect(markup).toMatch(/Review \d+ questions?|Add a question/);
    // Every count links to where the professor acts on it.
    expect(markup).toContain('href="/professor/review"');
    expect(markup).toContain('href="/professor/availability"');
    expect(markup).toContain('href="/professor/questions?view=approved"');
    // The pipeline strip and its system words are gone.
    expect(markup).not.toContain("Question pipeline");
    expect(markup).not.toContain("Immutable");
    expect(markup).not.toContain("held back");
  });

  it("enforces anonymous, student, and professor API access", async () => {
    mockPrincipal(undefined);
    const anonymous = await getReviewQueue(
      new Request("http://test/api/professor/review"),
    );

    mockPrincipal(TEST_STUDENT);
    const student = await getReviewQueue(
      new Request("http://test/api/professor/review"),
    );

    mockPrincipal(TEST_PROFESSOR);
    const professor = await getReviewQueue(
      new Request("http://test/api/professor/review"),
    );

    expect(anonymous.status).toBe(401);
    expect(student.status).toBe(403);
    expect(professor.status).toBe(200);
  });

  it("does not infer professor access from email or client fields", async () => {
    mockPrincipal({
      ...TEST_STUDENT,
      displayName: "Professor-Looking Student",
      email: "professor@suffolk.edu",
    });

    await expect(requireProfessor()).rejects.toBeInstanceOf(
      AuthorizationDeniedError,
    );

    const response = await getReviewQueue(
      new Request("http://test/api/professor/review", {
        headers: {
          "x-professor-token": "legacy-shared-secret",
          "x-user-role": "professor",
        },
      }),
    );
    expect(response.status).toBe(403);
  });
});

describe("professor sign-in and navigation", () => {
  afterEach(() => {
    resetAuthMocks();
  });

  it("uses a direct safe return instead of student onboarding", async () => {
    mockPrincipal(undefined);

    expect(postSignInPath("/professor?section=review")).toBe(
      "/professor?section=review",
    );
    expect(postSignInPath("/practice?questionId=dice-sum-eight")).toBe(
      "/onboarding?returnTo=%2Fpractice%3FquestionId%3Ddice-sum-eight",
    );
  });

  it("shows the Professor workspace link only for professor accounts", async () => {
    mockPrincipal(undefined);
    const anonymousMarkup = renderToStaticMarkup(await AccountActions());

    mockPrincipal(TEST_STUDENT);
    const studentMarkup = renderToStaticMarkup(await AccountActions());

    mockPrincipal(TEST_PROFESSOR);
    const professorMarkup = renderToStaticMarkup(await AccountActions());

    expect(anonymousMarkup).not.toContain("Professor workspace");
    expect(studentMarkup).not.toContain("Professor workspace");
    expect(professorMarkup).toContain('href="/professor"');
    expect(professorMarkup).toContain("Professor workspace");
    expect(professorMarkup).toContain("Account");
    expect(professorMarkup).toContain("Sign out");
  });
});

describe("server-controlled role provisioning", () => {
  it("keeps role writes and professor email rules out of application clients", () => {
    const clientSource = sourceFiles(path.join(process.cwd(), "src"))
      .filter((file) => readFileSync(file, "utf8").startsWith('"use client"'))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    const applicationSource = sourceFiles(path.join(process.cwd(), "src"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    expect(clientSource).not.toMatch(
      /user_roles|grantRole|role_id|publicMetadata[\s\S]{0,80}role|unsafeMetadata[\s\S]{0,80}role|PROFESSOR_(EMAILS|ALLOWLIST)/,
    );
    expect(applicationSource).not.toMatch(
      /updateUserMetadata|replaceUserMetadata|PROFESSOR_(EMAILS|ALLOWLIST)|allowedProfessorEmails|@suffolk\.edu/i,
    );
  });

  it("documents owner-only Clerk metadata provisioning", () => {
    const documentation = readFileSync(
      path.join(process.cwd(), "docs/authentication-authorization.md"),
      "utf8",
    );
    const packageJson = readFileSync(
      path.join(process.cwd(), "package.json"),
      "utf8",
    );

    expect(documentation).toContain("Assigning the professor role");
    expect(documentation).toContain('publicMetadata.role` to `"professor"');
    expect(documentation).toContain(
      "There is no administrator role or in-app role-management page",
    );
    expect(packageJson).not.toContain('"auth:role"');
  });
});

async function expectRedirect(
  operation: Promise<unknown>,
  destination: string,
) {
  try {
    await operation;
    throw new Error(`Expected a redirect to ${destination}.`);
  } catch (error) {
    const digest = (error as { digest?: string }).digest;
    expect(digest).toContain(`;${destination};`);
  }
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(entryPath);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  });
}
