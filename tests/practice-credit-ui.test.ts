import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InstructorStudentDetailPanel } from "@/components/professor/instructor-student-detail";
import type {
  InstructorQuestionCreditEvidence,
  InstructorStudentDetail,
} from "@/lib/types";

function evidenceRow(
  overrides: Partial<InstructorQuestionCreditEvidence> &
    Pick<InstructorQuestionCreditEvidence, "questionId" | "route">,
): InstructorQuestionCreditEvidence {
  return {
    questionTitle: `Question ${overrides.questionId}`,
    similarProblemAttempted: false,
    similarProblemSolved: false,
    solved: false,
    solvedWithinValidAttemptLimit: false,
    startOverUsed: false,
    topicId: "conditional-probability",
    topicTitle: "Conditional Probability",
    validAttempts: 0,
    workedSolutionViewedBeforeFirstCorrect: false,
    ...overrides,
  };
}

function detail(
  creditEvidence: InstructorQuestionCreditEvidence[],
): InstructorStudentDetail {
  return {
    activity: [],
    attention: [],
    attempts: [],
    creditEvidence,
    misconceptions: [],
    mode: "database",
    summary: {
      attempts: 6,
      correctAttempts: 2,
      extraPracticeSessions: 1,
      hintsUsed: 3,
      incorrectAttempts: 4,
      llmAttempts: 0,
      misconceptionAttempts: 0,
      needsAttention: false,
      sessions: 3,
      solutionsRevealed: 1,
      solvedSessions: 2,
      studentKey: "a".repeat(64),
      topicsPracticed: 1,
    },
    topics: [],
  };
}

describe("instructor practice credit evidence panel", () => {
  it("P: shows each route as credit evidence and never as a grade", () => {
    const markup = renderToStaticMarkup(
      createElement(InstructorStudentDetailPanel, {
        detail: detail([
          evidenceRow({
            questionId: "a",
            route: "full",
            solved: true,
            solvedWithinValidAttemptLimit: true,
            validAttempts: 2,
            validAttemptsToFirstCorrect: 2,
          }),
          evidenceRow({
            questionId: "b",
            route: "partial_similar",
            similarProblemAttempted: true,
            similarProblemSolved: true,
            validAttempts: 3,
            workedSolutionViewedBeforeFirstCorrect: true,
          }),
          evidenceRow({
            questionId: "c",
            route: "manual_review",
            solved: true,
            solvedWithinValidAttemptLimit: true,
            validAttempts: 2,
            validAttemptsToFirstCorrect: 2,
            workedSolutionViewedBeforeFirstCorrect: true,
          }),
          evidenceRow({
            questionId: "d",
            route: "not_qualified",
            similarProblemAttempted: true,
            validAttempts: 3,
          }),
        ]),
      }),
    );

    expect(markup).toContain("Practice credit evidence");
    expect(markup).toContain("Credit route");
    expect(markup).toContain("Full-credit route (1.0)");
    expect(markup).toContain(
      "Partial-credit route (0.9) · similar problem solved",
    );
    expect(markup).toContain("Manual review");
    expect(markup).toContain("Start over fallback is yours to judge");
    expect(markup).not.toContain("decision pending");
    expect(markup).toContain("Not yet qualified");
    expect(markup).toContain("2 to first correct");
    expect(markup).toContain("3, none correct");
    expect(markup).toContain("Attempted, not solved");
    expect(markup).toContain("evidence for your decision, not a grade");
    expect(markup).not.toMatch(/official grade|final grade|gradebook|course grade/i);
    // The raw submission metric is named for what it is, so it cannot be
    // read as the policy's valid-attempt count.
    expect(markup).toContain("Answer submissions");
    expect(markup).not.toContain(">Attempts<");
  });

  it("explains an empty evidence table without inventing rows", () => {
    const markup = renderToStaticMarkup(
      createElement(InstructorStudentDetailPanel, { detail: detail([]) }),
    );
    expect(markup).toContain(
      "No assigned-question practice has been recorded for this student yet.",
    );
  });
});
