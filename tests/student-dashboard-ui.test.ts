import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StudentProgressDashboard } from "@/lib/types";
import {
  mockPrincipal,
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
import PracticePage from "@/app/practice/page";
import { ProgressDashboard } from "@/components/student/progress-dashboard";

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
  ],
  recentSessions: [
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
    availableQuestions: 5,
    completedQuestions: 1,
    hintsUsed: 3,
    inProgressQuestions: 1,
    needsAnotherAttempt: 1,
    topicsStarted: 2,
  },
  topics: [
    {
      availableQuestions: 3,
      completedQuestions: 1,
      id: "conditional-probability",
      inProgressQuestions: 0,
      needsAnotherAttempt: 0,
      title: "Conditional Probability",
    },
    {
      availableQuestions: 2,
      completedQuestions: 0,
      id: "binomial-models",
      inProgressQuestions: 1,
      needsAnotherAttempt: 1,
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
      id: "conditional-probability",
      title: "Conditional Probability",
    },
  ]);
  mocks.getApprovedQuestions.mockResolvedValue([
    {
      id: "dice-sum-eight",
      topicId: "conditional-probability",
    },
  ]);
});

afterEach(() => {
  resetAuthMocks();
});

describe("authenticated student dashboard page", () => {
  it("redirects an unauthenticated visitor before reading progress", async () => {
    mockPrincipal(undefined);

    await expect(DashboardPage()).rejects.toMatchObject({
      destination: "/sign-in?callbackUrl=%2Fdashboard",
    });
    expect(mocks.getStudentProgress).not.toHaveBeenCalled();
  });

  it("passes only the server-authorized student's progress to the UI", async () => {
    mockPrincipal(TEST_STUDENT);

    const element = await DashboardPage();
    const markup = renderToStaticMarkup(element);

    expect(mocks.getStudentProgress).toHaveBeenCalledOnce();
    expect(markup).toContain("Your practice progress");
    expect(markup).toContain("Five-question quiz");
    expect(markup).not.toMatch(/leaderboard|class rank|percentile/i);
  });
});

describe("student progress dashboard states", () => {
  it("renders canonical topics, question states, retry guidance, and owned resume actions", () => {
    const markup = renderToStaticMarkup(
      createElement(ProgressDashboard, { progress }),
    );

    expect(markup).toContain("Syllabus topic progress");
    expect(markup.indexOf("Conditional Probability")).toBeLessThan(
      markup.indexOf("Binomial Models"),
    );
    expect(markup).toContain("In progress");
    expect(markup).toContain("Completed");
    expect(markup).toContain("Questions to try again");
    expect(markup).toContain("Recent tutor sessions");
    expect(markup).toContain("Hints used");
    expect(markup).toContain("Resume");
    expect(markup).toContain(
      'href="/practice?questionId=five-question-quiz&amp;sessionId=session%3Astudent-owned"',
    );
    expect(markup).toContain("not a formal course grade");
    expect(markup).not.toMatch(
      /leaderboard|class rank|percentile|other student/i,
    );
  });

  it("renders a clear empty state while retaining syllabus topics", () => {
    const emptyProgress: StudentProgressDashboard = {
      ...progress,
      questions: [],
      recentSessions: [],
      summary: {
        ...progress.summary,
        completedQuestions: 0,
        hintsUsed: 0,
        inProgressQuestions: 0,
        needsAnotherAttempt: 0,
        topicsStarted: 0,
      },
      topics: progress.topics.map((topic) => ({
        ...topic,
        completedQuestions: 0,
        inProgressQuestions: 0,
        needsAnotherAttempt: 0,
      })),
    };
    const markup = renderToStaticMarkup(
      createElement(ProgressDashboard, { progress: emptyProgress }),
    );

    expect(markup).toContain("No saved practice yet");
    expect(markup).toContain("Start practicing");
    expect(markup).toContain("Conditional Probability");
    expect(markup).toContain("No tutor sessions yet");
  });

  it("renders explicit loading and recoverable error states", () => {
    const loadingMarkup = renderToStaticMarkup(createElement(DashboardLoading));
    const errorMarkup = renderToStaticMarkup(
      createElement(DashboardError, {
        error: new Error("private database detail"),
        reset: () => undefined,
      }),
    );

    expect(loadingMarkup).toContain("Loading your practice progress");
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
