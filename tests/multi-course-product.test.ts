import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PLATFORM_COURSES } from "@/lib/course-catalog";
import { setContentRepositoryForTests } from "@/lib/data/data-store";
import { demoContentRepository } from "@/lib/data/demo-repository";
import type { ContentRepository, CourseScope } from "@/lib/data/repository";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_STUDENT,
} from "./auth-test-helpers";

const mocks = vi.hoisted(() => ({
  cookieValue: undefined as string | undefined,
  practiceProps: undefined as Record<string, unknown> | undefined,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "ai-tutor-course" && mocks.cookieValue !== undefined
        ? { name, value: mocks.cookieValue }
        : undefined,
    set: () => undefined,
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (destination: string) => {
    throw new Error(`Redirected to ${destination}`);
  },
  useRouter: () => ({ refresh: () => undefined }),
}));

vi.mock("@/components/tutor/practice-workspace", async () => {
  const { createElement: element } = await import("react");
  return {
    PracticeWorkspace: (props: Record<string, unknown>) => {
      mocks.practiceProps = props;
      return element("div", { "data-practice-workspace": true });
    },
  };
});

import HomePage from "@/app/page";
import LearnPage from "@/app/learn/page";
import PracticePage from "@/app/practice/page";
import { Logo } from "@/components/shell/logo";
import { getStudentProgress } from "@/lib/data/student-progress";
import { requireStudent } from "@/lib/auth/authorization";

const PROBABILITY_WORDS =
  /probabilit|conditional|sample space|venn|dice|MATH-255|Bayes|binomial/i;

/** The demo repository, scoped the way the database repository scopes it. */
function repositoryWithCalculusEmpty(): ContentRepository {
  return {
    ...demoContentRepository,
    async listTopics(scope?: CourseScope) {
      const topics = await demoContentRepository.listTopics();
      return scope?.courseId
        ? topics.filter((topic) => topic.courseId === scope.courseId)
        : topics;
    },
    async getTopics(scope?: CourseScope) {
      return this.listTopics(scope);
    },
  };
}

beforeEach(() => {
  mocks.cookieValue = undefined;
  mocks.practiceProps = undefined;
  mockPrincipal(TEST_STUDENT);
  vi.stubEnv("APP_DEMO_MODE", "true");
  vi.stubEnv("ANONYMOUS_PILOT_ENABLED", "true");
  setContentRepositoryForTests(repositoryWithCalculusEmpty());
});

afterEach(() => {
  setContentRepositoryForTests(undefined);
  vi.unstubAllEnvs();
  resetAuthMocks();
});

describe("Calculus I before any content is added", () => {
  beforeEach(() => {
    mocks.cookieValue = "calculus-1";
  });

  it("says so on Learn, with no Probability & Statistics content", async () => {
    const markup = renderToStaticMarkup(await LearnPage());

    expect(markup).toContain("Calculus I content has not been added yet.");
    expect(markup).not.toMatch(PROBABILITY_WORDS);
  });

  it("shows a neutral empty state on Practice instead of a workspace", async () => {
    const markup = renderToStaticMarkup(
      await PracticePage({ searchParams: Promise.resolve({}) }),
    );

    expect(mocks.practiceProps).toBeUndefined();
    expect(markup).toContain("Calculus I content has not been added yet.");
    expect(markup).toContain("Change course");
    expect(markup).not.toMatch(PROBABILITY_WORDS);
    expect(markup).not.toContain("Start by writing down");
  });

  it("names the course on the landing page without borrowing another course's code or content", async () => {
    const markup = renderToStaticMarkup(await HomePage());

    expect(markup).toContain("Practice Calculus I, one hint at a time");
    expect(markup).toContain("A question reaches students only after a Calculus I professor");
    expect(markup).not.toMatch(PROBABILITY_WORDS);
  });

  it("reports no progress", async () => {
    const progress = await getStudentProgress(await requireStudent(), {
      courseId: "calculus-1",
    });

    expect(progress.summary).toMatchObject({
      availableQuestions: 0,
      completedQuestions: 0,
      inProgressQuestions: 0,
      topicsStarted: 0,
    });
    expect(progress.topics).toEqual([]);
    expect(progress.questions).toEqual([]);
  });
});

describe("Probability & Statistics is still the default", () => {
  it("shows the existing course on Learn, Practice, and the landing page with no choice made", async () => {
    const learn = renderToStaticMarkup(await LearnPage());
    expect(learn).toContain("Introduction to Probability and Venn Diagrams");
    expect(learn).not.toContain("content has not been added yet");

    renderToStaticMarkup(
      await PracticePage({ searchParams: Promise.resolve({}) }),
    );
    expect(mocks.practiceProps).toBeDefined();
    expect(
      (mocks.practiceProps?.topics as unknown[]).length,
    ).toBe(11);

    const home = renderToStaticMarkup(await HomePage());
    expect(home).toContain("Practice MATH-255, one hint at a time");
  });
});

describe("product branding", () => {
  it("names the product AI Tutor, not after one course", () => {
    const logo = renderToStaticMarkup(
      createElement(Logo, { size: "sm", wordmark: true }),
    );
    expect(logo).toContain("AI Tutor");

    const layout = readFileSync(
      path.join(process.cwd(), "src/app/layout.tsx"),
      "utf8",
    );
    expect(layout).toContain('default: "AI Tutor"');
    expect(layout).toContain('template: "%s · AI Tutor"');
    expect(layout).toContain('applicationName: "AI Tutor"');
    expect(layout).not.toMatch(/MATH-255|probability/i);
  });

  it("leaves no course-specific product name in the application source", () => {
    const offenders: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory)) {
        const file = path.join(directory, entry);
        if (statSync(file).isDirectory()) {
          walk(file);
        } else if (/\.(tsx?|css)$/.test(entry)) {
          if (/ProbStat/.test(readFileSync(file, "utf8"))) {
            offenders.push(path.relative(process.cwd(), file));
          }
        }
      }
    };
    walk(path.join(process.cwd(), "src"));

    expect(offenders).toEqual([]);
  });

  it("keeps the course names themselves", () => {
    expect(DEFAULT_PLATFORM_COURSES.map((course) => course.title)).toEqual([
      "Probability & Statistics",
      "Calculus I",
    ]);
  });
});
