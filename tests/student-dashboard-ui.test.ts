import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StudentProgressDashboard } from "@/lib/types";
import {
  mockPrincipal,
  mockStudentOwner,
  resetAuthMocks,
  TEST_STUDENT,
} from "./auth-test-helpers";

const mocks = vi.hoisted(() => ({
  getApprovedQuestions: vi.fn(),
  getStudentProgress: vi.fn(),
  getTopics: vi.fn(),
  practiceProps: undefined as Record<string, unknown> | undefined,
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/lib/data/student-progress", () => ({
  getStudentProgress: mocks.getStudentProgress,
}));

vi.mock("@/lib/data/data-store", () => ({
  getApprovedQuestions: mocks.getApprovedQuestions,
  getTopics: mocks.getTopics,
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

import DashboardError from "@/app/dashboard/error";
import DashboardLoading from "@/app/dashboard/loading";
import DashboardPage from "@/app/dashboard/page";
import LearnPage from "@/app/learn/page";
import PracticePage from "@/app/practice/page";

class RedirectSignal extends Error {
  constructor(readonly destination: string) {
    super(`Redirected to ${destination}`);
  }
}

const progress: StudentProgressDashboard = {
  mode: "database",
  questions: [
    {
      attemptCount: 2,
      available: true,
      completedAt: "2026-08-13T10:00:00.000Z",
      hintsUsed: 1,
      lastActiveAt: "2026-08-13T10:00:00.000Z",
      needsAnotherAttempt: false,
      questionId: "dice-sum-eight",
      questionTitle: "Two fair dice",
      resumeSessionId: "session:completed-owned",
      status: "completed",
      topicId: "conditional-probability",
      topicTitle: "Conditional Probability",
    },
    {
      attemptCount: 1,
      available: true,
      hintsUsed: 2,
      lastActiveAt: "2026-08-14T10:00:00.000Z",
      needsAnotherAttempt: true,
      questionId: "five-question-quiz",
      questionTitle: "Five-question quiz",
      resumeSessionId: "session:student-owned",
      status: "in_progress",
      topicId: "binomial-models",
      topicTitle: "Binomial Models",
    },
    {
      attemptCount: 1,
      available: false,
      completedAt: "2026-08-12T10:00:00.000Z",
      hintsUsed: 0,
      lastActiveAt: "2026-08-12T10:00:00.000Z",
      needsAnotherAttempt: false,
      questionId: "withdrawn-question",
      questionTitle: "Earlier published question",
      status: "completed",
      topicId: "conditional-probability",
      topicTitle: "Conditional Probability",
    },
  ],
  recentSessions: [
    {
      attemptCount: 1,
      available: false,
      hintsUsed: 0,
      lastSeenAt: "2026-08-12T10:00:00.000Z",
      needsAnotherAttempt: false,
      questionId: "withdrawn-question",
      questionTitle: "Earlier published question",
      sessionId: "session:withdrawn-owned",
      status: "unavailable",
      stepsRevealed: 0,
      topicId: "conditional-probability",
      topicTitle: "Conditional Probability",
    },
    {
      attemptCount: 1,
      available: true,
      hintsUsed: 2,
      lastSeenAt: "2026-08-14T10:00:00.000Z",
      needsAnotherAttempt: true,
      questionId: "five-question-quiz",
      questionTitle: "Five-question quiz",
      sessionId: "session:student-owned",
      status: "in_progress",
      stepsRevealed: 0,
      topicId: "binomial-models",
      topicTitle: "Binomial Models",
    },
  ],
  summary: {
    availableCompletedQuestions: 1,
    availableQuestions: 5,
    completedQuestions: 2,
    hintsUsed: 3,
    inProgressQuestions: 1,
    needsAnotherAttempt: 1,
    previouslyCompletedQuestions: 1,
    topicsStarted: 2,
  },
  topics: [
    {
      availableQuestions: 3,
      completedQuestions: 1,
      id: "conditional-probability",
      inProgressQuestions: 0,
      needsAnotherAttempt: 0,
      previouslyCompletedQuestions: 1,
      title: "Conditional Probability",
    },
    {
      availableQuestions: 2,
      completedQuestions: 0,
      id: "binomial-models",
      inProgressQuestions: 1,
      needsAnotherAttempt: 1,
      previouslyCompletedQuestions: 0,
      title: "Binomial Models",
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.practiceProps = undefined;
  mocks.redirect.mockImplementation((destination: string) => {
    throw new RedirectSignal(destination);
  });
  mocks.getStudentProgress.mockResolvedValue(progress);
  mocks.getTopics.mockResolvedValue([
    {
      active: true,
      description: "Restrict the sample space.",
      id: "conditional-probability",
      moduleRef: "Week 3",
      order: 3,
      title: "Conditional Probability",
      weekNumber: 3,
    },
  ]);
  mocks.getApprovedQuestions.mockResolvedValue([
    {
      answer: {
        acceptedAnswers: ["PRIVATE-ACCEPTED-ANSWER"],
        explanation: "PRIVATE-ANSWER-EXPLANATION",
      },
      difficulty: "foundational",
      hints: ["PRIVATE-HINT-BODY"],
      id: "dice-sum-eight",
      misconceptions: [
        {
          feedback: "PRIVATE-MISCONCEPTION-FEEDBACK",
          id: "private-rule",
          matchTerms: ["PRIVATE-MATCH-TERM"],
        },
      ],
      prompt: "What is the probability?",
      review: { status: "approved" },
      solutionSteps: ["PRIVATE-SOLUTION-STEP"],
      source: {
        sourceType: "original_demo",
        trustLevel: "public_original",
        visibility: "public",
      },
      title: "Two fair dice",
      topicId: "conditional-probability",
    },
  ]);
});

afterEach(() => {
  resetAuthMocks();
});

describe("the learn page and the dashboard redirect", () => {
  it("sends the retired dashboard URL to /learn without reading progress", () => {
    mockPrincipal(TEST_STUDENT);

    expect(() => DashboardPage()).toThrow("Redirected to /learn");
    expect(mocks.redirect).toHaveBeenCalledWith("/learn");
    expect(mocks.getStudentProgress).not.toHaveBeenCalled();
  });

  it("passes only the server-authorized student's progress to the UI", async () => {
    mockPrincipal(TEST_STUDENT);

    const element = await LearnPage();
    const markup = renderToStaticMarkup(element);

    expect(mocks.getStudentProgress).toHaveBeenCalledOnce();
    expect(markup).toContain("Continue");
    expect(markup).toContain("Five-question quiz");
    expect(markup).not.toContain("Guest · your progress lives in this browser.");
    expect(markup).not.toMatch(/leaderboard|class rank|percentile/i);
  });

  it("tells a browser with anonymous practice that its progress lives in this browser", async () => {
    mockPrincipal(undefined);
    mockStudentOwner({ anonymousId: "anonymous-browser", kind: "anonymous" });

    const markup = renderToStaticMarkup(await LearnPage());

    expect(mocks.getStudentProgress).toHaveBeenCalledOnce();
    expect(markup).toContain("Five-question quiz");
    expect(markup).toContain("Guest · your progress lives in this browser.");
    expect(markup).toContain("Sign in to keep it");
    expect(markup).toContain('href="/join"');
  });

  it("renders the guest view instead of reading a stranger's progress", async () => {
    mockPrincipal(undefined);
    mockStudentOwner(undefined);

    const markup = renderToStaticMarkup(await LearnPage());

    expect(mocks.getStudentProgress).not.toHaveBeenCalled();
    expect(markup).toContain("Guest · your progress lives in this browser.");
    expect(markup).not.toContain("Five-question quiz");
  });
});

describe("dashboard loading and error states", () => {
  it("renders explicit loading and recoverable error states", () => {
    const loadingMarkup = renderToStaticMarkup(createElement(DashboardLoading));
    const errorMarkup = renderToStaticMarkup(
      createElement(DashboardError, {
        error: new Error("private database detail"),
        reset: () => undefined,
      }),
    );

    // The same label as /learn, which is where /dashboard lands.
    expect(loadingMarkup).toContain("Loading your syllabus");
    expect(loadingMarkup).not.toContain("Loading your practice progress");
    expect(errorMarkup).toContain("Your progress could not be loaded");
    expect(errorMarkup).toContain("Try again");
    expect(errorMarkup).not.toContain("private database detail");
  });
});

describe("dashboard resume handoff", () => {
  it("passes a safe owned session id into the practice workspace", async () => {
    const element = await PracticePage({
      searchParams: Promise.resolve({
        questionId: "dice-sum-eight",
        sessionId: "session:student-owned",
      }),
    });
    renderToStaticMarkup(element);

    expect(mocks.practiceProps).toMatchObject({
      initialQuestionId: "dice-sum-eight",
      initialSessionId: "session:student-owned",
    });
    expect(mocks.practiceProps?.questions).toEqual([
      expect.objectContaining({
        hintCount: 1,
        id: "dice-sum-eight",
        stepCount: 1,
      }),
    ]);
    expect(JSON.stringify(mocks.practiceProps?.questions)).not.toMatch(
      /PRIVATE-|acceptedAnswers|answer|hints|solutionSteps|misconceptions|matchTerms/,
    );
  });

  it("drops malformed session ids before the client boundary", async () => {
    const element = await PracticePage({
      searchParams: Promise.resolve({
        questionId: "dice-sum-eight",
        sessionId: "../../other-student",
      }),
    });
    renderToStaticMarkup(element);

    expect(mocks.practiceProps).toMatchObject({
      initialQuestionId: "dice-sum-eight",
      initialSessionId: undefined,
    });
  });
});
