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
import ProfessorLayout from "@/app/professor/layout";
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
    expect(markup).toContain("does not have access to instructor tools");
    expect(markup).toContain('href="/dashboard"');
    expect(markup).toContain('href="/account"');
    expect(markup).not.toContain("required application role");
  });

  it("renders the workspace for an authenticated professor", async () => {
    mockPrincipal(TEST_PROFESSOR);
    const protectedChild = createElement("p", null, "protected");

    await expect(ProfessorLayout({ children: protectedChild })).resolves.toBe(
      protectedChild,
    );

    const markup = renderToStaticMarkup(await ProfessorPage());
    expect(markup).toContain("Professor workspace");
    expect(markup).toContain("Review generated practice questions");
    expect(markup).toContain(
      "Review changes are attributed to the signed-in account",
    );
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

  it("shows instructor navigation and a clear sign-out action only after access", async () => {
    mockPrincipal(TEST_STUDENT);
    const studentMarkup = renderToStaticMarkup(await AccountActions());

    mockPrincipal(TEST_PROFESSOR);
    const professorMarkup = renderToStaticMarkup(await AccountActions());

    expect(studentMarkup).not.toContain("Instructor tools");
    expect(professorMarkup).toContain('href="/professor"');
    expect(professorMarkup).toContain("Instructor tools");
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
