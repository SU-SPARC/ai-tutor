import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CourseTopic,
  StudentPracticeQuestion,
  StudentProgressDashboard,
  TutorQuestion,
} from "@/lib/types";
import { mockPrincipal, resetAuthMocks, TEST_STUDENT } from "./auth-test-helpers";

const mocks = vi.hoisted(() => ({
  getApprovedQuestionById: vi.fn(),
  getApprovedQuestions: vi.fn(),
  getQuestionCounts: vi.fn(),
  getTopics: vi.fn(),
  listQuestionsByTopic: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: mocks.redirect,
}));

vi.mock("@/lib/data/data-store", () => ({
  getApprovedQuestionById: mocks.getApprovedQuestionById,
  getApprovedQuestions: mocks.getApprovedQuestions,
  getQuestionCounts: mocks.getQuestionCounts,
  getTopics: mocks.getTopics,
  listQuestionsByTopic: mocks.listQuestionsByTopic,
}));

import HomePage from "@/app/page";
import PracticePage from "@/app/practice/page";
import PracticeQuestionNotFound from "@/app/practice/[questionId]/not-found";
import ApplicationError from "@/app/error";
import TopicDetailPage from "@/app/topics/[slug]/page";
import TopicsPage from "@/app/topics/page";
import {
  primaryPracticeAction,
  ProgressDashboard,
} from "@/components/student/progress-dashboard";
import {
  PracticeSimilarProblemAction,
  similarProblemStatusMessage,
} from "@/components/tutor/practice-similar-problem-action";
import {
  chatMessageForResponse,
  nextQuestionAfter,
  PracticeWorkspace,
  recoveryMessages,
} from "@/components/tutor/practice-workspace";
import {
  inputFormatHintFor,
  normalizeSummary,
} from "@/lib/api/question-serialization";
import { studentQuestionTitle } from "@/lib/labels";

class RedirectSignal extends Error {
  constructor(readonly destination: string) {
    super(`Redirected to ${destination}`);
  }
}

const STUDENT_VISIBLE_TECHNICAL_TERMS =
  /\bLLM\b|fallback|database|migration|fixture|candidate|\bReserve\b|parser|answer spec|provider|retrieval|Postgres|Supabase|OpenRouter|status code|internal error|number_list|categorical/i;

const topics: CourseTopic[] = [
  {
    active: true,
    description: "Restrict the sample space.",
    id: "conditional-probability",
    moduleRef: "Week 3",
    order: 3,
    title: "Conditional Probability",
    weekNumber: 3,
  },
  {
    active: true,
    description: "Approximate sample means.",
    id: "central-limit-theorem",
    moduleRef: "Week 13",
    order: 13,
    title: "Central Limit Theorem",
    weekNumber: 13,
  },
];

const approvedQuestions: TutorQuestion[] = [
  {
    answer: {
      acceptedAnswers: ["2/5", "0.4"],
      explanation: "PRIVATE-EXPLANATION",
      numericValue: 0.4,
    },
    difficulty: "foundational",
    hints: ["PRIVATE-HINT-1", "PRIVATE-HINT-2", "PRIVATE-HINT-3"],
    id: "dice-sum-eight",
    misconceptions: [],
    prompt: "Two fair dice are rolled. Given that the sum is 8, what is $P(A)$?",
    review: { status: "approved" },
    solutionSteps: ["PRIVATE-STEP"],
    source: {
      sourceType: "original_demo",
      trustLevel: "public_original",
      visibility: "public",
    },
    title: "Dice Sum Condition",
    topicId: "conditional-probability",
  },
  {
    answer: {
      acceptedAnswers: ["1/3"],
      explanation: "PRIVATE-EXPLANATION-2",
    },
    difficulty: "intermediate",
    hints: ["PRIVATE-HINT"],
    id: "spinner-coin",
    misconceptions: [],
    prompt: "A spinner has 5 equal sectors.",
    review: { status: "approved" },
    solutionSteps: ["PRIVATE-STEP"],
    source: {
      sourceType: "original_demo",
      trustLevel: "public_original",
      visibility: "public",
    },
    title: "Spinner and Coin Condition Draft",
    topicId: "conditional-probability",
  },
];

const studentQuestions: StudentPracticeQuestion[] =
  approvedQuestions.map(normalizeSummary);

function renderWorkspace(
  props: Partial<Parameters<typeof PracticeWorkspace>[0]> = {},
) {
  return renderToStaticMarkup(
    createElement(PracticeWorkspace, {
      questions: studentQuestions,
      topics,
      ...props,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((destination: string) => {
    throw new RedirectSignal(destination);
  });
  mocks.getTopics.mockResolvedValue(topics);
  mocks.getApprovedQuestions.mockResolvedValue(approvedQuestions);
  mocks.getApprovedQuestionById.mockImplementation(async (id: string) =>
    approvedQuestions.find((question) => question.id === id),
  );
  mocks.getQuestionCounts.mockResolvedValue({
    byTopic: { "conditional-probability": 2 },
    total: 2,
  });
  mocks.listQuestionsByTopic.mockImplementation(async (topicId: string) =>
    approvedQuestions.filter((question) => question.topicId === topicId),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetAuthMocks();
});

describe("new student reaching practice", () => {
  it("lets an anonymous student open practice while the pilot is enabled", async () => {
    vi.stubEnv("ANONYMOUS_PILOT_ENABLED", "true");
    mockPrincipal(undefined);

    const markup = renderToStaticMarkup(
      await PracticePage({ searchParams: Promise.resolve({}) }),
    );

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(markup).toContain("Dice Sum Condition");
    expect(markup).toContain("Check answer");
  });

  it("sends a signed-out student to sign in instead of a dead-end question when the pilot is off", async () => {
    vi.stubEnv("ANONYMOUS_PILOT_ENABLED", "false");
    mockPrincipal(undefined);

    await expect(
      PracticePage({
        searchParams: Promise.resolve({ topicId: "conditional-probability" }),
      }),
    ).rejects.toMatchObject({
      destination:
        "/sign-in?callbackUrl=%2Fpractice%3FtopicId%3Dconditional-probability",
    });
  });

  it("lets a signed-in student practice when the pilot is off", async () => {
    vi.stubEnv("ANONYMOUS_PILOT_ENABLED", "false");
    mockPrincipal(TEST_STUDENT);

    const markup = renderToStaticMarkup(
      await PracticePage({ searchParams: Promise.resolve({}) }),
    );

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(markup).toContain("Check answer");
  });
});

describe("topic selection", () => {
  it("presents available topics first and the rest of the syllabus as coming soon", async () => {
    const markup = renderToStaticMarkup(await TopicsPage());

    expect(markup).toContain("Available for this pilot");
    expect(markup).toContain("More topics coming soon");
    expect(markup.indexOf("Available for this pilot")).toBeLessThan(
      markup.indexOf("More topics coming soon"),
    );
    expect(markup.indexOf("Conditional Probability")).toBeLessThan(
      markup.indexOf("Central Limit Theorem"),
    );
    expect(markup).toContain("Start practicing");
    expect(markup).toContain('href="/practice?topicId=conditional-probability"');
    expect(markup).toContain("Coming soon");
    expect(markup).toContain("About this topic");
    expect(markup).toContain('href="/topics/central-limit-theorem"');
    expect(markup).not.toContain("Nothing to practice yet");
    expect(markup).not.toMatch(STUDENT_VISIBLE_TECHNICAL_TERMS);
  });

  it("omits the coming-soon section once every topic has practice", async () => {
    mocks.getQuestionCounts.mockResolvedValue({
      byTopic: { "central-limit-theorem": 1, "conditional-probability": 2 },
      total: 3,
    });

    const markup = renderToStaticMarkup(await TopicsPage());

    expect(markup).toContain("Available for this pilot");
    expect(markup).not.toContain("More topics coming soon");
    expect(markup).not.toContain("Coming soon");
  });

  it("keeps the syllabus visible when no topic has practice yet", async () => {
    mocks.getQuestionCounts.mockResolvedValue({ byTopic: {}, total: 0 });

    const markup = renderToStaticMarkup(await TopicsPage());

    expect(markup).toContain("Practice questions are being prepared");
    expect(markup).toContain("More topics coming soon");
    expect(markup).toContain("Conditional Probability");
    expect(markup).not.toContain("Start practicing");
  });

  it("shows published question titles without the authoring Draft marker", async () => {
    const markup = renderToStaticMarkup(
      await TopicDetailPage({
        params: Promise.resolve({ slug: "conditional-probability" }),
      }),
    );

    expect(markup).toContain("Spinner and Coin Condition");
    expect(markup).not.toMatch(/\bDraft\b/);
  });

  it("shows a graceful empty-topic state instead of a question from another topic", () => {
    const markup = renderWorkspace({ initialTopicId: "central-limit-theorem" });

    expect(markup).toContain(
      "No practice questions are available for this topic yet.",
    );
    expect(markup).toContain("Choose another topic");
    expect(markup).toContain('href="/topics"');
    expect(markup).not.toContain("Dice Sum Condition");
    expect(markup).not.toContain("Check answer");
  });

  it("starts at the first available question and selects its topic when the first listed topic is empty", () => {
    // Central Limit Theorem (no questions) is listed first; Conditional
    // Probability, which has questions, is second.
    const markup = renderWorkspace({ topics: [topics[1], topics[0]] });

    expect(markup).toContain("Dice Sum Condition");
    expect(markup).toContain("Check answer");
    // Progress is computed against the displayed question's topic, so the
    // position label renders and the sidebar expands that topic.
    expect(markup).toContain("Question 1 of 2");
    expect(markup).toContain('aria-current="true"');
    expect(markup).toMatch(
      /aria-expanded="true"(?:(?!<\/button>)[\s\S])*?Conditional Probability/,
    );
    expect(markup).toMatch(
      /aria-expanded="false"(?:(?!<\/button>)[\s\S])*?Central Limit Theorem/,
    );
    expect(markup).not.toContain("No practice questions yet.");
    expect(markup).not.toContain(
      "No practice questions are available for this topic yet.",
    );
  });

  it("keeps the empty-topic state for a requested empty first topic instead of falling back", () => {
    const markup = renderWorkspace({
      initialTopicId: "central-limit-theorem",
      topics: [topics[1], topics[0]],
    });

    expect(markup).toContain(
      "No practice questions are available for this topic yet.",
    );
    expect(markup).toContain("Central Limit Theorem has");
    expect(markup).toContain("Choose another topic");
    expect(markup).not.toContain("Dice Sum Condition");
    expect(markup).not.toContain("Check answer");
    expect(markup).not.toContain("Question 1 of 2");
  });

  it("offers a way forward when no questions exist at all", () => {
    const markup = renderWorkspace({ questions: [] });

    expect(markup).toContain("No practice questions are available");
    expect(markup).toContain("Browse topics");
  });
});

describe("question screen", () => {
  it("renders the question, progress, format guidance, and primary actions", () => {
    const markup = renderWorkspace({ initialQuestionId: "dice-sum-eight" });

    expect(markup).toContain("Dice Sum Condition");
    expect(markup).toContain("Two fair dice are rolled.");
    expect(markup).toContain("Question 1 of 2");
    expect(markup).toContain("Foundational");
    expect(markup).not.toContain(">foundational<");
    expect(markup).toContain("Your answer");
    expect(markup).toContain(
      "Enter a decimal, fraction, or percentage, for example 0.25, 1/4, or 25%.",
    );
    expect(markup).toContain("Check answer");
    expect(markup).toContain("Get a hint");
    expect(markup).toContain("(3 left)");
    expect(markup).toContain("All topics");
    expect(markup).toContain("Your progress");
    expect(markup).not.toMatch(STUDENT_VISIBLE_TECHNICAL_TERMS);
    expect(markup).not.toMatch(/PRIVATE-/);
    expect(markup).toContain("Spinner and Coin Condition");
    expect(markup).not.toMatch(/\bDraft\b/);
  });

  it("never offers AI help unless the server enabled it", () => {
    expect(renderWorkspace({ initialQuestionId: "dice-sum-eight" })).not.toContain(
      "Ask AI for help",
    );
  });
});

describe("answer feedback", () => {
  const base = { hints: [], steps: [], retrievedContext: [] };

  it("shows a clear correct state with the explanation", () => {
    const message = chatMessageForResponse({
      ...base,
      message: "There are five outcomes with sum 8, and two include a 3.",
      misconceptions: [],
      verdict: "correct",
    });

    expect(message).toMatchObject({ label: "Correct", tone: "correct" });
    expect(message.text).toContain("five outcomes");
  });

  it("surfaces misconception guidance on an incorrect answer without shaming", () => {
    const message = chatMessageForResponse({
      ...base,
      message: "Not quite. I found a likely misconception to check first.",
      misconceptions: [
        "You appear to be counting from all 36 dice outcomes. Restrict the sample space first.",
      ],
      verdict: "incorrect",
    });

    expect(message).toMatchObject({ label: "Not quite", tone: "incorrect" });
    expect(message.note).toContain("Restrict the sample space");
    expect(message.text).not.toMatch(/^Not quite/);
    expect(message.text).not.toMatch(/wrong/i);
  });

  it("treats unreadable input as format guidance, not a wrong attempt", () => {
    const message = chatMessageForResponse({
      ...base,
      message: "I could not read that as a number. Try forms like 0.25, 1/4, or 25%.",
      misconceptions: [],
      verdict: "guidance",
    });

    expect(message).toMatchObject({
      label: "Couldn't read that answer",
      tone: "guidance",
    });
    expect(message.note).toContain("not marked wrong");
    expect(message.tone).not.toBe("incorrect");
  });

  it("keeps blocked help out of the incorrect styling and free of technical wording", () => {
    const message = chatMessageForResponse({
      ...base,
      message:
        "AI assistance is currently unavailable. Your saved progress is unchanged; continue with the available course guidance or try again later.",
      misconceptions: [],
      verdict: "blocked",
    });

    expect(message.tone).toBe("notice");
    expect(`${message.label} ${message.text}`).not.toMatch(
      STUDENT_VISIBLE_TECHNICAL_TERMS,
    );
  });

  it("restores a solved session as a correct state and an incorrect attempt as try-again guidance", () => {
    const question = studentQuestions[0];
    const solved = recoveryMessages(
      {
        attempts: [{ createdAt: "", fallbackUsed: false, misconceptionFeedback: [], submittedAnswer: "2/5", verdict: "correct" }],
        disclosedAnswerExplanation: "Five outcomes have sum 8.",
        disclosedSolutionSteps: [],
      },
      question,
    );
    const incorrect = recoveryMessages(
      {
        attempts: [{ createdAt: "", fallbackUsed: false, misconceptionFeedback: ["Restrict the sample space."], submittedAnswer: "5/36", verdict: "incorrect" }],
        disclosedSolutionSteps: [],
      },
      question,
    );

    expect(solved.at(-1)).toMatchObject({ label: "Correct", text: "Five outcomes have sum 8.", tone: "correct" });
    expect(incorrect.at(-1)).toMatchObject({ label: "Not quite", note: "Restrict the sample space.", tone: "incorrect" });
  });
});

describe("session progress and completion", () => {
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("continues to the next unsolved question in the topic", () => {
    expect(nextQuestionAfter("a", list, new Set())).toEqual({ id: "b" });
    expect(nextQuestionAfter("a", list, new Set(["b"]))).toEqual({ id: "c" });
    expect(nextQuestionAfter("c", list, new Set(["c"]))).toEqual({ id: "a" });
  });

  it("reports completion when every question is solved", () => {
    expect(
      nextQuestionAfter("c", list, new Set(["a", "b", "c"])),
    ).toBeUndefined();
  });
});

describe("similar practice", () => {
  it("offers a similar problem in student language", () => {
    const html = renderToStaticMarkup(
      createElement(PracticeSimilarProblemAction, {
        disabled: false,
        onMatch: vi.fn(),
        sessionId: "session:completed",
      }),
    );

    expect(html).toContain("Try a similar problem");
    expect(html).toContain("professor-approved");
    expect(html).not.toMatch(STUDENT_VISIBLE_TECHNICAL_TERMS);
  });

  it("falls back gracefully when nothing similar exists", () => {
    expect(similarProblemStatusMessage("none")).toBe(
      "No similar problem is available right now. You can continue to the next question or choose another topic.",
    );
    expect(similarProblemStatusMessage("error")).not.toMatch(
      STUDENT_VISIBLE_TECHNICAL_TERMS,
    );
  });
});

describe("answer format guidance", () => {
  it("describes accepted notation without revealing the answer", () => {
    expect(
      inputFormatHintFor({
        acceptedAnswers: ["0.42"],
        explanation: "x",
        spec: {
          domain: "probability",
          kind: "numeric",
          percentMode: "either",
          tolerance: { mode: "exact" },
          value: "0.42",
        },
      }),
    ).toBe(
      "Enter a decimal, fraction, or percentage, for example 0.25, 1/4, or 25%.",
    );
    expect(
      inputFormatHintFor({
        acceptedAnswers: ["0.42"],
        explanation: "x",
        spec: {
          domain: "probability",
          kind: "numeric",
          percentMode: "decimal",
          tolerance: { mode: "exact" },
          value: "0.42",
        },
      }),
    ).not.toContain("%");
    expect(
      inputFormatHintFor({
        acceptedAnswers: ["360"],
        explanation: "x",
        spec: {
          domain: "count",
          kind: "numeric",
          percentMode: "decimal",
          tolerance: { mode: "exact" },
          value: "360",
        },
      }),
    ).toContain("whole number");
    expect(
      inputFormatHintFor({
        acceptedAnswers: ["1/4"],
        explanation: "x",
        spec: {
          domain: "probability",
          formPolicy: "require",
          kind: "numeric",
          percentMode: "either",
          requiredForm: "simplified_fraction",
          tolerance: { mode: "exact" },
          value: "1/4",
        },
      }),
    ).toContain("This question asks for a simplified fraction.");
    expect(
      inputFormatHintFor({
        acceptedAnswers: ["10, 2"],
        explanation: "x",
        spec: {
          kind: "number_list",
          labels: ["mean", "standard deviation"],
          ordered: true,
          tolerance: { mode: "exact" },
          values: ["10", "2"],
        },
      }),
    ).toBe(
      "Enter 2 values separated by commas, in this order: mean, standard deviation.",
    );
    expect(
      inputFormatHintFor({
        acceptedAnswers: ["independent"],
        aliases: [],
        explanation: "x",
        spec: {
          aliases: ["indep"],
          canonical: "independent",
          kind: "categorical",
        },
      } as TutorQuestion["answer"]),
    ).toBe("Type a short response in words.");
    expect(
      inputFormatHintFor({ acceptedAnswers: ["7/12"], explanation: "x" }),
    ).toContain("fraction");
    expect(
      inputFormatHintFor({ acceptedAnswers: ["$1.60"], explanation: "x" }),
    ).toBe("Type your response in the box below.");
  });

  it("never mentions the expected value or implementation terms", () => {
    const hint = inputFormatHintFor({
      acceptedAnswers: ["0.263671875"],
      explanation: "x",
      numericValue: 0.263671875,
    });
    expect(hint).not.toContain("0.26");
    expect(hint).not.toMatch(STUDENT_VISIBLE_TECHNICAL_TERMS);
  });
});

describe("home page pilot scope", () => {
  it("explains that more topics are coming while some are still empty", async () => {
    mockPrincipal(undefined);

    const markup = renderToStaticMarkup(await HomePage());

    expect(markup).toContain("2 practice questions across 1 topic ready now.");
    expect(markup).toContain(
      "This pilot currently includes practice for the first course topics.",
    );
    expect(markup).toContain("More topics will be added as they are reviewed.");
    expect(markup).not.toMatch(STUDENT_VISIBLE_TECHNICAL_TERMS);
  });

  it("drops the pilot note once every topic has practice", async () => {
    mockPrincipal(undefined);
    mocks.getQuestionCounts.mockResolvedValue({
      byTopic: { "central-limit-theorem": 1, "conditional-probability": 2 },
      total: 3,
    });

    const markup = renderToStaticMarkup(await HomePage());

    expect(markup).toContain("3 practice questions across 2 topics ready now.");
    expect(markup).not.toContain("This pilot currently includes");
  });
});

describe("student-facing question titles", () => {
  it("drops a trailing authoring Draft marker only", () => {
    expect(studentQuestionTitle("Club Membership Union Draft")).toBe(
      "Club Membership Union",
    );
    expect(studentQuestionTitle("Campus badge flag draft")).toBe(
      "Campus badge flag",
    );
    expect(studentQuestionTitle("Neither Newsletter (Draft)")).toBe(
      "Neither Newsletter",
    );
    expect(studentQuestionTitle("Award Placements - Draft")).toBe(
      "Award Placements",
    );
    expect(studentQuestionTitle("Overdraft Fee Draft")).toBe("Overdraft Fee");
    expect(studentQuestionTitle("Draft Picks Probability")).toBe(
      "Draft Picks Probability",
    );
    expect(studentQuestionTitle("Drafting Rules")).toBe("Drafting Rules");
    expect(studentQuestionTitle("Draft")).toBe("Draft");
  });

  it("applies the cleanup to the public question summary but not the id", () => {
    const summary = normalizeSummary(approvedQuestions[1]);

    expect(summary.title).toBe("Spinner and Coin Condition");
    expect(summary.id).toBe("spinner-coin");
  });
});

describe("student dashboard", () => {
  const progress: StudentProgressDashboard = {
    mode: "database",
    questions: [
      {
        attemptCount: 1,
        available: true,
        hintsUsed: 1,
        lastActiveAt: "2026-09-09T10:00:00.000Z",
        needsAnotherAttempt: true,
        questionId: "spinner-coin",
        questionTitle: "Spinner and Coin Condition",
        resumeSessionId: "session:in-progress",
        status: "in_progress",
        topicId: "conditional-probability",
        topicTitle: "Conditional Probability",
      },
    ],
    recentSessions: [
      {
        attemptCount: 1,
        available: true,
        hintsUsed: 1,
        lastSeenAt: "2026-09-09T10:00:00.000Z",
        needsAnotherAttempt: true,
        questionId: "spinner-coin",
        questionTitle: "Spinner and Coin Condition",
        sessionId: "session:in-progress",
        status: "in_progress",
        stepsRevealed: 0,
        topicId: "conditional-probability",
        topicTitle: "Conditional Probability",
      },
    ],
    summary: {
      availableCompletedQuestions: 0,
      availableQuestions: 2,
      completedQuestions: 0,
      hintsUsed: 1,
      inProgressQuestions: 1,
      needsAnotherAttempt: 1,
      previouslyCompletedQuestions: 0,
      topicsStarted: 1,
    },
    topics: [
      {
        availableQuestions: 2,
        completedQuestions: 0,
        id: "conditional-probability",
        inProgressQuestions: 1,
        needsAnotherAttempt: 1,
        previouslyCompletedQuestions: 0,
        title: "Conditional Probability",
      },
    ],
  };

  it("tells a returning student to continue where they left off", () => {
    expect(primaryPracticeAction(progress)).toMatchObject({
      href: "/practice?questionId=spinner-coin&sessionId=session%3Ain-progress",
      label: "Continue practice",
      questionTitle: "Spinner and Coin Condition",
    });

    const markup = renderToStaticMarkup(
      createElement(ProgressDashboard, { progress }),
    );
    expect(markup).toContain("Continue practice");
    expect(markup).toContain("Up next:");
    expect(markup).not.toMatch(STUDENT_VISIBLE_TECHNICAL_TERMS);
  });

  it("shows dashboard question titles without the authoring Draft marker", () => {
    const withDraft: StudentProgressDashboard = {
      ...progress,
      questions: [
        { ...progress.questions[0], questionTitle: "Award Placements Draft" },
      ],
      recentSessions: [
        {
          ...progress.recentSessions[0],
          questionTitle: "Award Placements Draft",
        },
      ],
    };

    expect(primaryPracticeAction(withDraft).questionTitle).toBe(
      "Award Placements",
    );
    const markup = renderToStaticMarkup(
      createElement(ProgressDashboard, { progress: withDraft }),
    );
    expect(markup).toContain("Award Placements");
    expect(markup).not.toMatch(/\bDraft\b/);
  });

  it("tells a new student to start practicing", () => {
    const empty: StudentProgressDashboard = {
      ...progress,
      questions: [],
      recentSessions: [],
      summary: { ...progress.summary, hintsUsed: 0, inProgressQuestions: 0, needsAnotherAttempt: 0, topicsStarted: 0 },
    };

    expect(primaryPracticeAction(empty)).toMatchObject({
      href: "/practice",
      label: "Start practicing",
    });
    const markup = renderToStaticMarkup(
      createElement(ProgressDashboard, { progress: empty }),
    );
    expect(markup).toContain("No saved practice yet");
    expect(markup).toContain("Start practicing");
  });
});

describe("student-facing error states", () => {
  it("keeps error and not-found pages free of technical wording and with a next action", () => {
    const notFound = renderToStaticMarkup(createElement(PracticeQuestionNotFound));
    const failure = renderToStaticMarkup(
      createElement(ApplicationError, {
        error: new Error("ECONNREFUSED postgres"),
        reset: () => undefined,
      }),
    );

    expect(notFound).toContain("Browse topics");
    expect(failure).toContain("Try again");
    expect(failure).not.toContain("ECONNREFUSED");
    expect(`${notFound}${failure}`).not.toMatch(STUDENT_VISIBLE_TECHNICAL_TERMS);
  });
});
