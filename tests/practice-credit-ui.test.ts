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
      aiHelpRequests: 0,
      attempts: 6,
      correctAttempts: 2,
      extraPracticeSessions: 1,
      hintsUsed: 3,
      incorrectAttempts: 4,
      llmAttempts: 0,
      misconceptionAttempts: 0,
      needsAttention: false,
      sessions: 3,
      sketchpadActiveSeconds: 0,
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

    expect(markup).toContain("Credit suggestions by question");
    expect(markup).toContain("Suggested credit");
    expect(markup).toContain("Full credit");
    expect(markup).toContain("90% (solved a similar problem)");
    expect(markup).toContain("Your call");
    expect(markup).toContain("The tutor can’t tell whether a similar problem was");
    expect(markup).not.toContain("decision pending");
    expect(markup).toContain("Not yet");
    expect(markup).toContain("Solved in 2 tries");
    expect(markup).toContain("Solved after viewing the solution");
    expect(markup).toContain("Tried, not solved");
    // The detailed counts stay one click away.
    expect(markup).toContain("How credit is suggested");
    expect(markup).toContain("Correct on try 2");
    expect(markup).toContain("3 tries, none correct");
    expect(markup).toContain("A suggestion to help you decide, not a grade.");
    expect(markup).not.toMatch(/official grade|final grade|gradebook|course grade/i);
    // The raw submission metric is named for what it is, so it cannot be
    // read as the policy's try count.
    expect(markup).toContain("2 of 6 answers checked");
    expect(markup).not.toContain(">Attempts<");
    expect(markup).not.toContain("Credit route");
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
