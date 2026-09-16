import { describe, expect, it } from "vitest";

import {
  derivePracticeCreditEvidence,
  FULL_CREDIT_VALID_ATTEMPT_LIMIT,
  isValidAnswerAttempt,
  isWorkedSolutionReveal,
  PRACTICE_CREDIT_ROUTE_LABELS,
  similarProblemOriginQualifies,
  VALID_ANSWER_ATTEMPT_SQL,
  WORKED_SOLUTION_REVEAL_SQL,
  type PracticeCreditInteraction,
} from "@/lib/tutor/practice-credit";

type Step =
  | "correct"
  | "incorrect"
  | "unreadable"
  | "blocked"
  | "hint"
  | "solution"
  | "full_solution"
  | "ai_help"
  | "empty";

/**
 * Builds the recorded interactions for a sequence of student actions, in
 * order, exactly as the tutor persists them: every action is a row, and only
 * readable checks carry a correct/incorrect verdict.
 */
function interactions(steps: Step[], startAt = 0): PracticeCreditInteraction[] {
  return steps.map((step, index) => {
    const createdAt = new Date(
      Date.UTC(2026, 8, 12, 10, 0, startAt + index),
    ).toISOString();
    const id = String(startAt + index + 1);
    switch (step) {
      case "correct":
      case "incorrect":
        return { createdAt, id, mode: "check", verdict: step };
      case "unreadable":
      case "empty":
        return { createdAt, id, mode: "check", verdict: "guidance" };
      case "blocked":
        return { createdAt, id, mode: "check", verdict: "blocked" };
      case "ai_help":
        // AI help is sent as a check with the AI path answering; it never
        // returns a correct/incorrect verdict of its own.
        return { createdAt, id, mode: "check", verdict: "guidance" };
      case "hint":
        return { createdAt, id, mode: "hint", verdict: "guidance" };
      case "solution":
      case "full_solution":
        return { createdAt, id, mode: step, verdict: "guidance" };
    }
  });
}

function evidence(
  steps: Step[],
  options: {
    similar?: Array<{ attempted: boolean; solved: boolean }>;
    sessions?: number;
    solved?: boolean;
  } = {},
) {
  return derivePracticeCreditEvidence({
    interactions: interactions(steps),
    publishedSessionCount: options.sessions ?? 1,
    similarProblems: options.similar ?? [],
    solved: options.solved ?? false,
  });
}

describe("valid answer attempt definition", () => {
  it("counts only readable checks marked correct or incorrect", () => {
    expect(isValidAnswerAttempt({ mode: "check", verdict: "correct" })).toBe(
      true,
    );
    expect(isValidAnswerAttempt({ mode: "check", verdict: "incorrect" })).toBe(
      true,
    );
    expect(isValidAnswerAttempt({ mode: "check", verdict: "guidance" })).toBe(
      false,
    );
    expect(isValidAnswerAttempt({ mode: "check", verdict: "blocked" })).toBe(
      false,
    );
    expect(isValidAnswerAttempt({ mode: "hint", verdict: "guidance" })).toBe(
      false,
    );
    expect(
      isValidAnswerAttempt({ mode: "full_solution", verdict: "guidance" }),
    ).toBe(false);
    expect(isValidAnswerAttempt({ mode: "check" })).toBe(false);
  });

  it("treats a legacy row without a mode as a check submission", () => {
    expect(isValidAnswerAttempt({ verdict: "incorrect" })).toBe(true);
    expect(isValidAnswerAttempt({ verdict: "guidance" })).toBe(false);
  });

  it("recognises both solution reveal modes", () => {
    expect(isWorkedSolutionReveal({ mode: "solution" })).toBe(true);
    expect(isWorkedSolutionReveal({ mode: "full_solution" })).toBe(true);
    expect(isWorkedSolutionReveal({ mode: "check" })).toBe(false);
  });

  it("keeps the SQL fragments equivalent to the predicates", () => {
    expect(VALID_ANSWER_ATTEMPT_SQL).toBe(
      "(a.mode = 'check' and a.verdict in ('correct', 'incorrect'))",
    );
    expect(WORKED_SOLUTION_REVEAL_SQL).toBe(
      "(a.mode in ('solution', 'full_solution'))",
    );
    expect(FULL_CREDIT_VALID_ATTEMPT_LIMIT).toBe(3);
  });
});

describe("practice credit route derivation", () => {
  it("A: an unreadable submission leaves the valid-attempt count at zero", () => {
    expect(evidence(["unreadable"])).toMatchObject({
      route: "not_qualified",
      solved: false,
      validAttempts: 0,
      validAttemptsToFirstCorrect: undefined,
    });
  });

  it("B: an incorrect answer is one valid attempt", () => {
    expect(evidence(["incorrect"])).toMatchObject({
      route: "not_qualified",
      validAttempts: 1,
    });
  });

  it("C: correct on the first valid attempt is the full-credit route", () => {
    expect(evidence(["correct"])).toMatchObject({
      route: "full",
      solved: true,
      solvedWithinValidAttemptLimit: true,
      validAttempts: 1,
      validAttemptsToFirstCorrect: 1,
      workedSolutionViewedBeforeFirstCorrect: false,
    });
  });

  it("D: unreadable submissions between attempts never consume one", () => {
    expect(
      evidence(["incorrect", "unreadable", "incorrect", "unreadable", "correct"]),
    ).toMatchObject({
      route: "full",
      validAttempts: 3,
      validAttemptsToFirstCorrect: 3,
    });
  });

  it("E: a fourth valid attempt is no longer the full-credit route", () => {
    expect(
      evidence(["incorrect", "incorrect", "incorrect", "correct"]),
    ).toMatchObject({
      route: "not_qualified",
      solved: true,
      solvedWithinValidAttemptLimit: false,
      validAttemptsToFirstCorrect: 4,
    });
  });

  it("F: Start over does not reset the valid-attempt count", () => {
    const beforeRestart = interactions(["incorrect", "incorrect", "incorrect"]);
    const afterRestart = interactions(["correct"], 10);
    const result = derivePracticeCreditEvidence({
      // Deliberately out of order: the derivation sorts by time itself.
      interactions: [...afterRestart, ...beforeRestart],
      publishedSessionCount: 2,
      similarProblems: [],
      solved: true,
    });

    expect(result).toMatchObject({
      route: "not_qualified",
      solvedWithinValidAttemptLimit: false,
      startOverUsed: true,
      validAttempts: 4,
      validAttemptsToFirstCorrect: 4,
    });
  });

  it("G: three unsuccessful attempts, the worked solution, then a solved linked similar problem is the partial route", () => {
    expect(
      evidence(["incorrect", "incorrect", "incorrect", "full_solution"], {
        similar: [{ attempted: true, solved: true }],
      }),
    ).toMatchObject({
      route: "partial_similar",
      similarProblemAttempted: true,
      similarProblemSolved: true,
      solved: false,
      workedSolutionViewedBeforeFirstCorrect: true,
    });
  });

  it("H: a similar problem attempted but not solved does not qualify yet", () => {
    expect(
      evidence(["incorrect", "incorrect", "incorrect", "full_solution"], {
        similar: [{ attempted: true, solved: false }],
      }),
    ).toMatchObject({
      route: "not_qualified",
      similarProblemAttempted: true,
      similarProblemSolved: false,
    });
  });

  it("I: reserve practice that is not linked to the question never counts", () => {
    // The caller passes only linked similar problems; with none linked, a
    // solved unrelated reserve question cannot reach the derivation at all.
    expect(
      evidence(["incorrect", "incorrect", "incorrect", "full_solution"], {
        similar: [],
      }),
    ).toMatchObject({ route: "not_qualified", similarProblemSolved: false });
  });

  it("J: 3 wrong, the worked solution, Start over, then correct is never full and goes to manual review", () => {
    expect(
      evidence(
        ["incorrect", "incorrect", "incorrect", "full_solution", "correct"],
        { sessions: 2 },
      ),
    ).toMatchObject({
      route: "manual_review",
      solved: true,
      solvedWithinValidAttemptLimit: false,
      startOverUsed: true,
      validAttemptsToFirstCorrect: 4,
      workedSolutionViewedBeforeFirstCorrect: true,
    });
  });

  it("4: the worked solution revealed before a correct attempt 1, 2 or 3 is never full", () => {
    for (const steps of [
      ["full_solution", "correct"],
      ["full_solution", "incorrect", "correct"],
      ["incorrect", "full_solution", "incorrect", "correct"],
    ] as Step[][]) {
      const result = evidence(steps);
      expect(result.route).not.toBe("full");
      expect(result.route).toBe("manual_review");
      expect(result.solvedWithinValidAttemptLimit).toBe(true);
      expect(result.workedSolutionViewedBeforeFirstCorrect).toBe(true);
    }
  });

  it("manual review never yields a number and never appears for an unsolved question", () => {
    expect(PRACTICE_CREDIT_ROUTE_LABELS.manual_review).not.toMatch(/1\.0|0\.9/);
    expect(
      evidence(["incorrect", "incorrect", "incorrect", "full_solution"]).route,
    ).toBe("not_qualified");
  });

  it("K: hints do not count as attempts", () => {
    expect(evidence(["hint", "hint", "hint", "correct"])).toMatchObject({
      route: "full",
      validAttempts: 1,
      validAttemptsToFirstCorrect: 1,
    });
  });

  it("L: AI help does not count as an attempt", () => {
    expect(evidence(["hint", "ai_help", "ai_help", "correct"])).toMatchObject({
      route: "full",
      validAttempts: 1,
    });
  });

  it("M: a solution reveal is not a valid attempt but is remembered", () => {
    expect(evidence(["full_solution", "correct"])).toMatchObject({
      route: "manual_review",
      solvedWithinValidAttemptLimit: true,
      validAttempts: 1,
      validAttemptsToFirstCorrect: 1,
      workedSolutionViewedBeforeFirstCorrect: true,
    });
  });

  it("N: blocked and empty submissions are recorded but excluded", () => {
    expect(evidence(["blocked", "empty", "incorrect", "correct"])).toMatchObject({
      route: "full",
      validAttempts: 2,
      validAttemptsToFirstCorrect: 2,
    });
  });

  it("orders same-instant rows by numeric id rather than text", () => {
    const at = new Date(Date.UTC(2026, 8, 12)).toISOString();
    const result = derivePracticeCreditEvidence({
      interactions: [
        { createdAt: at, id: "10", mode: "check", verdict: "correct" },
        { createdAt: at, id: "9", mode: "full_solution", verdict: "guidance" },
      ],
      publishedSessionCount: 1,
      similarProblems: [],
      solved: true,
    });
    expect(result.workedSolutionViewedBeforeFirstCorrect).toBe(true);
    expect(result.route).toBe("manual_review");
  });

  it("prefers a solved similar problem over manual review", () => {
    expect(
      evidence(["incorrect", "incorrect", "incorrect", "full_solution", "correct"], {
        similar: [{ attempted: true, solved: true }],
      }).route,
    ).toBe("partial_similar");
  });

  it("reports a solved counter-only session without inventing attempts", () => {
    expect(evidence([], { solved: true })).toMatchObject({
      route: "not_qualified",
      solved: true,
      validAttempts: 0,
    });
  });

  it("never labels a route as a grade", () => {
    for (const label of Object.values(PRACTICE_CREDIT_ROUTE_LABELS)) {
      expect(label).not.toMatch(/grade/i);
    }
    expect(PRACTICE_CREDIT_ROUTE_LABELS.full).toContain("1.0");
    expect(PRACTICE_CREDIT_ROUTE_LABELS.partial_similar).toContain("0.9");
  });

  it("never emits the removed routes", () => {
    const routes = new Set([
      evidence(["full_solution", "incorrect", "correct"]).route,
      evidence(["incorrect", "incorrect", "incorrect", "full_solution", "correct"]).route,
      evidence(["incorrect", "incorrect", "incorrect", "full_solution"], { sessions: 2, solved: true }).route,
    ]);
    expect([...routes]).not.toContain("partial_original");
    expect([...routes]).not.toContain("pending_decision");
  });
});

describe("similar-problem origin gate (application side of migration 025)", () => {
  const solved = { questionId: "q", revealedSteps: 0, solved: true };
  const unsolved = (revealedSteps: number) => ({
    questionId: "q",
    revealedSteps,
    solved: false,
    status: "active",
  });
  const session = (steps: Step[], questionId = "q") => ({
    attempts: interactions(steps),
    practiceContext: "published" as const,
    questionId,
  });

  it("K: a solved origin qualifies as before", () => {
    expect(
      similarProblemOriginQualifies({
        origin: solved,
        stepCount: 3,
        studentSessions: [session(["correct"])],
      }),
    ).toBe(true);
  });

  it("E: three valid attempts and the fully revealed solution qualify", () => {
    expect(
      similarProblemOriginQualifies({
        origin: unsolved(3),
        stepCount: 3,
        studentSessions: [session(["incorrect", "incorrect", "incorrect", "full_solution"])],
      }),
    ).toBe(true);
  });

  it("D: three valid attempts without the solution do not qualify", () => {
    expect(
      similarProblemOriginQualifies({
        origin: unsolved(0),
        stepCount: 3,
        studentSessions: [session(["incorrect", "incorrect", "incorrect"])],
      }),
    ).toBe(false);
  });

  it("F: two valid attempts with the solution do not qualify", () => {
    expect(
      similarProblemOriginQualifies({
        origin: unsolved(3),
        stepCount: 3,
        studentSessions: [session(["incorrect", "unreadable", "incorrect", "full_solution"])],
      }),
    ).toBe(false);
  });

  it("counts valid attempts across Start over but not other questions or reserve sessions", () => {
    const studentSessions = [
      session(["incorrect", "incorrect"]),
      session(["incorrect"]),
      session(["incorrect", "incorrect", "incorrect"], "other-question"),
      { ...session(["incorrect", "incorrect", "incorrect"]), practiceContext: "reserve_practice" as const },
    ];
    expect(
      similarProblemOriginQualifies({ origin: unsolved(2), stepCount: 2, studentSessions }),
    ).toBe(true);
    expect(
      similarProblemOriginQualifies({
        origin: unsolved(2),
        stepCount: 2,
        studentSessions: studentSessions.slice(1),
      }),
    ).toBe(false);
  });

  it("requires a published origin and a question with solution steps", () => {
    expect(
      similarProblemOriginQualifies({
        origin: { ...unsolved(3), practiceContext: "reserve_practice" },
        stepCount: 3,
        studentSessions: [session(["incorrect", "incorrect", "incorrect"])],
      }),
    ).toBe(false);
    expect(
      similarProblemOriginQualifies({
        origin: unsolved(0),
        stepCount: 0,
        studentSessions: [session(["incorrect", "incorrect", "incorrect"])],
      }),
    ).toBe(false);
  });
});
