import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as simulate } from "@/app/api/professor/answer-checker/route";
import {
  AnswerCheckingEditor,
  categoricalAcceptedAnswers,
  normalizeLines,
} from "@/components/professor/answer-checking-editor";
import { getApprovedQuestionById } from "@/lib/data/data-store";
import {
  listTutorSessionsForStudent,
  resetTutorSessionsForTests,
} from "@/lib/data/tutor-session-repository";
import { checkAnswer } from "@/lib/tutor/answer-checker";
import { decideTutorResponse } from "@/lib/tutor/tutor-engine";
import {
  getTutorSessionState,
  getTutorAttemptSnapshotsForTests,
  resetTutorStateForTests,
} from "@/lib/tutor/tutor-state";
import { detectMisconceptions } from "@/lib/tutor/misconceptions";
import { validateContentTransferDocument } from "@/lib/content-transfer/schema";
import {
  validateQuestionIntakeModelDraft,
  verifyQuestionIntakeDraft,
} from "@/lib/question-intake/schema";
import type { QuestionIntakeModelDraft } from "@/lib/question-intake/types";
import type { AnswerSpec } from "@/lib/tutor/answer/spec";
import { validDocument, validQuestion } from "./content-transfer-test-helpers";
import {
  authorizationForStudentOwner,
  mockPrincipal,
  resetAuthMocks,
  TEST_ANONYMOUS_OWNER,
  TEST_PROFESSOR,
  TEST_STUDENT,
} from "./auth-test-helpers";

const numeric: AnswerSpec = {
  kind: "numeric",
  value: "0.5",
  domain: "probability",
  percentMode: "either",
  tolerance: { mode: "exact" },
};
const category: AnswerSpec = {
  kind: "categorical",
  canonical: "seven",
  aliases: ["7", "seven"],
};
beforeEach(() => {
  vi.stubEnv("APP_DEMO_MODE", "true");
  vi.stubEnv("DATABASE_URL", "");
  resetTutorSessionsForTests();
  resetTutorStateForTests();
  mockPrincipal(TEST_PROFESSOR);
});
afterEach(() => {
  resetAuthMocks();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("typed tutor behavior", () => {
  it("keeps typed mixed aliases categorical and legacy mixed aliases unchanged", async () => {
    const base = (await getApprovedQuestionById("dice-sum-eight"))!;
    for (const spec of [category, undefined]) {
      const question = {
        ...base,
        answer: {
          acceptedAnswers: ["seven", "7"],
          explanation: "The count is seven.",
          ...(spec ? { spec } : {}),
        },
      };
      const state = getTutorSessionState(`mixed-${spec?.kind}`, question.id);
      const result = await decideTutorResponse({
        question,
        answer: "eight",
        mode: "check",
        allowLlmFallback: false,
        state,
        sessionId: state.sessionId,
      });
      expect(result.response.verdict).toBe(spec ? "incorrect" : "guidance");
      expect(result.state.wrongAttemptCount).toBe(spec ? 1 : 0);
    }
  });
  it("keeps malformed numeric and list answers unscored without revealing hints", async () => {
    const base = (await getApprovedQuestionById("dice-sum-eight"))!;
    for (const spec of [
      numeric,
      {
        kind: "number_list",
        values: ["1", "2"],
        ordered: true,
        tolerance: { mode: "exact" },
      } satisfies AnswerSpec,
    ]) {
      const question = { ...base, answer: { ...base.answer, spec } };
      const state = getTutorSessionState(
        `unreadable-${spec.kind}`,
        question.id,
      );
      const result = await decideTutorResponse({
        question,
        answer: "abc",
        mode: "check",
        allowLlmFallback: false,
        state,
        sessionId: state.sessionId,
      });
      expect(result.response).toMatchObject({
        verdict: "guidance",
        hints: [],
        checkDetail: "unknown_token",
      });
      expect(result.state.wrongAttemptCount).toBe(0);
    }
  });
  it("keeps free-text coaching and misconception feedback available", async () => {
    const base = (await getApprovedQuestionById("dice-sum-eight"))!;
    const question = { ...base, answer: { ...base.answer, spec: numeric } };
    const state = {
      ...getTutorSessionState("typed-coaching", question.id),
      hintsRevealed: question.hints.length,
    };
    const result = await decideTutorResponse({
      question,
      answer: "I am not sure how to express this setup.",
      mode: "check",
      allowLlmFallback: true,
      state,
      sessionId: state.sessionId,
    });
    expect(result.response.source).toBe("retrieval");
    const misconception = await decideTutorResponse({
      question,
      answer: "I used P(A)+P(B) for the and event",
      mode: "check",
      allowLlmFallback: false,
      state,
      sessionId: state.sessionId,
    });
    expect(misconception.response.verdict).toBe("incorrect");
    expect(misconception.state.lastMisconceptionIds).toContain(
      "union-vs-intersection",
    );
  });
  it("extends union/intersection scope to conditional probability only", () => {
    const studentAnswer = "I used P(A)+P(B) for the and event";
    expect(
      detectMisconceptions({
        studentAnswer,
        topicId: "conditional-probability",
      }).map((m) => m.id),
    ).toContain("union-vs-intersection");
    expect(
      detectMisconceptions({
        studentAnswer,
        topicId: "normal-standardization",
      }).map((m) => m.id),
    ).not.toContain("union-vs-intersection");
  });
});

describe("professor checker preview", () => {
  const answer = {
    acceptedAnswers: ["0.5"],
    explanation: "Divide by two.",
    spec: numeric,
  };
  function request(body: unknown) {
    return new Request("http://localhost/api/professor/answer-checker", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
  it.each([TEST_STUDENT, undefined])(
    "rejects unauthorized preview",
    async (principal) => {
      mockPrincipal(principal);
      const response = await simulate(
        request({ answer, studentAnswer: "0.5" }),
      );
      expect([401, 403]).toContain(response.status);
    },
  );
  it("uses the real checker without sessions, attempts, lifecycle writes, or LLM calls", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    const response = await simulate(request({ answer, studentAnswer: "1/2" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      checkAnswer({ ...answer, studentAnswer: "1/2" }),
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(getTutorAttemptSnapshotsForTests()).toEqual([]);
    expect(
      (
        await listTutorSessionsForStudent(
          authorizationForStudentOwner(TEST_ANONYMOUS_OWNER),
        )
      ).sessions,
    ).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    const source = readFileSync(
      "src/app/api/professor/answer-checker/route.ts",
      "utf8",
    );
    expect(source).not.toMatch(/from ["']@\/lib\/(?:data|ai)\//);
  });
  it("rejects oversized submissions and invalid configurations", async () => {
    expect(
      (await simulate(request({ answer, studentAnswer: "a".repeat(501) })))
        .status,
    ).toBe(400);
    expect(
      (
        await simulate(
          request({
            answer: { ...answer, spec: { kind: "numeric" } },
            studentAnswer: "1",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await simulate(request({ answer, studentAnswer: "a".repeat(32768) })))
        .status,
    ).toBe(400);
  });
  it.each([
    undefined,
    numeric,
    category,
    {
      kind: "number_list",
      values: ["1", "2"],
      ordered: true,
      tolerance: { mode: "exact" },
    } satisfies AnswerSpec,
  ])("renders kind-specific authoring and preview controls", (spec) => {
    const html = renderToStaticMarkup(
      createElement(AnswerCheckingEditor, {
        answer: { ...answer, spec },
        onChange: () => {},
      }),
    );
    expect(html).toContain("Answer checking");
    expect(html).toContain("Try an answer");
    expect(html).toContain("No student session or attempt is recorded");
    if (spec?.kind === "numeric")
      expect(html).toContain("Percent interpretation");
    if (spec?.kind === "categorical")
      expect(html).toContain("Forbidden phrases");
    if (spec?.kind === "number_list")
      expect(html).toContain("Require this order");
  });
});

describe("typed content transfer and AI intake", () => {
  it("preserves transfer v1 compatibility and validates optional typed metadata", () => {
    expect(
      validateContentTransferDocument(validDocument()).document?.schemaVersion,
    ).toBe(1);
    const question = validQuestion({
      answer: {
        acceptedAnswers: ["seven", "7"],
        explanation: "The count is seven.",
        spec: category,
      },
    });
    const result = validateContentTransferDocument(
      validDocument({ questions: [question] }),
    );
    expect(result.document?.questions[0].answer.spec).toEqual(category);
    const invalid = validateContentTransferDocument(
      validDocument({
        questions: [
          {
            ...question,
            answer: { ...question.answer, spec: { ...numeric, value: "2" } },
          },
        ],
      }),
    );
    expect(invalid.document).toBeUndefined();
  });
  it("validates AI-proposed checker metadata and preserves professor review", () => {
    const draft: QuestionIntakeModelDraft = {
      schemaVersion: 1,
      title: "Typed proposal",
      prompt: "One of two outcomes is favorable. Find the probability.",
      topicId: "conditional-probability",
      questionType: "free_response",
      answerType: "numeric",
      difficulty: "foundational",
      answer: {
        acceptedAnswers: ["0.5", "1/2"],
        explanation: "The probability is 0.5.",
        spec: numeric,
      },
      hints: [
        "Identify the relevant outcomes.",
        "Divide favorable outcomes by all outcomes.",
      ],
      solutionSteps: ["Compute 1/2 = 0.5."],
      misconceptions: [],
      confidence: {
        answer: 0.95,
        extraction: 1,
        topic: 0.9,
        overall: 0.9,
        checker: 0.9,
      },
      warnings: [],
      unreadableSegments: [],
    };
    const parsed = validateQuestionIntakeModelDraft(draft, [
      { id: draft.topicId, title: "Conditional Probability", description: "" },
    ]);
    expect(parsed.errors).toEqual([]);
    const reviewed = verifyQuestionIntakeDraft(parsed.draft!, [
      { id: draft.topicId, title: "Conditional Probability", description: "" },
    ]);
    expect(reviewed.review).toMatchObject({
      required: true,
      status: "needs_professor_review",
    });
    expect(reviewed.review.checks).toContainEqual(
      expect.objectContaining({
        code: "answer_checker_config",
        status: "passed",
      }),
    );
    expect(
      reviewed.review.checks.find(
        (c) => c.code === "answer_solution_consistency",
      )?.status,
    ).toBe("passed");
    expect(
      validateQuestionIntakeModelDraft(
        {
          ...draft,
          answer: { ...draft.answer, spec: { ...numeric, value: "2" } },
        },
        [
          {
            id: draft.topicId,
            title: "Conditional Probability",
            description: "",
          },
        ],
      ).errors.length,
    ).toBeGreaterThan(0);
    expect(
      verifyQuestionIntakeDraft(
        {
          ...draft,
          answer: { ...draft.answer, spec: { ...numeric, value: "2" } },
        },
        [],
      ).review.checks,
    ).toContainEqual(
      expect.objectContaining({
        code: "answer_checker_config",
        status: "failed",
      }),
    );
  });
});

describe("percent notation form policy in the tutor", () => {
  it.each([
    ["note", "correct", true],
    ["require", "incorrect", false],
  ] as const)(
    "decimal mode with formPolicy %s grades 25%% as %s",
    async (formPolicy, verdict, solved) => {
      const base = (await getApprovedQuestionById("dice-sum-eight"))!;
      const spec = {
        kind: "numeric",
        value: "0.25",
        domain: "probability",
        percentMode: "decimal",
        tolerance: { mode: "exact" },
        formPolicy,
      } satisfies AnswerSpec;
      const question = {
        ...base,
        answer: { ...base.answer, acceptedAnswers: ["0.25"], spec },
      };
      const state = getTutorSessionState(`percent-${formPolicy}`, question.id);
      const result = await decideTutorResponse({
        question,
        answer: "25%",
        mode: "check",
        allowLlmFallback: false,
        state,
        sessionId: state.sessionId,
      });
      expect(result.response).toMatchObject({
        verdict,
        checkDetail: "wrong_form",
      });
      expect(result.state.solved).toBe(solved);
      expect(result.response.message).toMatch(/decimal or fraction/);
      if (solved) {
        expect(result.response.message).toContain(base.answer.explanation);
        expect(result.state.wrongAttemptCount).toBe(0);
      } else {
        expect(result.state.wrongAttemptCount).toBe(1);
        expect(result.response.message).not.toContain("0.25");
      }
      const bare = await decideTutorResponse({
        question,
        answer: "25",
        mode: "check",
        allowLlmFallback: false,
        state,
        sessionId: state.sessionId,
      });
      expect(bare.response).toMatchObject({
        verdict: "incorrect",
        checkDetail: "percent_decimal_confusion",
      });
      expect(bare.state.solved).toBe(false);
    },
  );
});

describe("professor editor input hygiene", () => {
  it.each([
    ["seven\n7\n", ["seven", "7"]],
    ["seven\r\n7\r\n\r\n", ["seven", "7"]],
    ["  seven  \n\n   \n\t7\t", ["seven", "7"]],
    ["\n \n", []],
    ["", []],
  ])("normalizes %j to %j", (text, lines) =>
    expect(normalizeLines(text)).toEqual(lines),
  );
  it("derives categorical accepted answers from the canonical answer and aliases", () => {
    expect(
      categoricalAcceptedAnswers({
        canonical: " seven ",
        aliases: ["7", "seven", "", "  ", "Seven"],
      }),
    ).toEqual(["seven", "7", "Seven"]);
    expect(categoricalAcceptedAnswers({ canonical: "", aliases: [] })).toEqual(
      [],
    );
  });
  it("never emits raw split lines from any multiline field", () => {
    const source = readFileSync(
      "src/components/professor/answer-checking-editor.tsx",
      "utf8",
    );
    expect(source).not.toContain('.split("\\n")');
    expect(source).toContain("<LinesTextarea");
    expect(
      readFileSync("src/components/professor/lines-textarea.tsx", "utf8"),
    ).toContain("normalizeLines(e.target.value)");
  });
  it("hides the competing accepted-answer control for categorical specs only", () => {
    const html = (spec: AnswerSpec) =>
      renderToStaticMarkup(
        createElement(AnswerCheckingEditor, {
          answer: { acceptedAnswers: ["seven", "7"], explanation: "x", spec },
          onChange: () => {},
        }),
      );
    const legacyControl = "Accepted answers (one complete answer per line)";
    const categorical = html(category);
    expect(categorical).not.toContain(legacyControl);
    expect(categorical).toContain("accepted equivalent answers");
    expect(categorical).toContain(
      "canonical answer and its aliases are the accepted answers",
    );
    expect(html(numeric)).toContain(legacyControl);
    expect(
      html({
        kind: "number_list",
        values: ["1"],
        ordered: true,
        tolerance: { mode: "exact" },
      }),
    ).toContain(legacyControl);
  });
});
