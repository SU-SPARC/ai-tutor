import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CourseTopic, TutorQuestion } from "@/lib/types";
import { mockPrincipal, TEST_STUDENT } from "./auth-test-helpers";

const mocks = vi.hoisted(() => ({
  getApprovedQuestions: vi.fn(),
  getTopics: vi.fn(),
}));

vi.mock("@/lib/data/data-store", () => ({
  getApprovedQuestions: mocks.getApprovedQuestions,
  getTopics: mocks.getTopics,
}));

import PracticePage from "@/app/practice/page";

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
];

const approvedQuestions: TutorQuestion[] = [
  {
    answer: { acceptedAnswers: ["2/5"], explanation: "PRIVATE-EXPLANATION" },
    difficulty: "foundational",
    hints: ["PRIVATE-HINT-1", "PRIVATE-HINT-2"],
    id: "dice-sum-eight",
    misconceptions: [],
    prompt: "Two fair dice are rolled.",
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
    answer: { acceptedAnswers: ["1/3"], explanation: "PRIVATE-EXPLANATION-2" },
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
    title: "Spinner and Coin Condition",
    topicId: "conditional-probability",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockPrincipal(TEST_STUDENT);
  mocks.getTopics.mockResolvedValue(topics);
  mocks.getApprovedQuestions.mockResolvedValue(approvedQuestions);
});

async function renderPractice() {
  return renderToStaticMarkup(
    await PracticePage({ searchParams: Promise.resolve({}) }),
  );
}

describe("practice layout", () => {
  it("renders the rail, the sheet, and the tutor drawer in one three-column shell", async () => {
    const markup = await renderPractice();

    expect(markup).toContain('data-slot="three-column"');
    expect(markup).toContain('data-slot="three-column-rail"');
    expect(markup).toContain('data-slot="question-sheet"');
    expect(markup).toContain('data-slot="three-column-drawer"');
  });

  it("labels the rail with the week of the topic being practised", async () => {
    const markup = await renderPractice();

    expect(markup).toContain('data-slot="practice-rail"');
    expect(markup).toContain(">Wk 3<");
    // The sheet header repeats the week in its mono line.
    expect(markup).toContain("Wk 3 · 1 of 2");
  });

  it("says what the tutor can see before the student types anything", async () => {
    const markup = await renderPractice();

    expect(markup).toContain(
      "Tutor sees this question, your hints so far, and your last attempt. Not your name.",
    );
  });

  it("carries position in the sheet footer so the rail is never required", async () => {
    const markup = await renderPractice();

    expect(markup).toContain('data-slot="practice-footer"');
    expect(markup).toContain(">1/2<");
    expect(markup).toContain('aria-label="Questions in this topic"');
  });

  it("keeps the phone tutor sheet collapsed to its handle", async () => {
    const markup = await renderPractice();

    expect(markup).toContain('data-slot="practice-mobile-sheet"');
    expect(markup).toContain('data-state="closed"');
  });
});
