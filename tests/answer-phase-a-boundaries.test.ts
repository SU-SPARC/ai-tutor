import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/tutor/respond/route";
import { getApprovedQuestionById } from "@/lib/data/data-store";
import {
  createTutorSession,
  getTutorSession,
  resetTutorSessionsForTests,
} from "@/lib/data/tutor-session-repository";
import {
  checkStudentAttempt,
  decideTutorResponse,
} from "@/lib/tutor/tutor-engine";
import {
  detectMisconceptions,
  PROBABILITY_STATISTICS_MISCONCEPTIONS,
} from "@/lib/tutor/misconceptions";
import {
  getTutorSessionState,
  resetTutorStateForTests,
} from "@/lib/tutor/tutor-state";
import {
  authorizationForStudentOwner,
  mockStudentOwner,
  resetAuthMocks,
  TEST_ANONYMOUS_OWNER,
} from "./auth-test-helpers";

const message =
  "I could not read that as a number. Try forms like 0.25, 1/4, or 25%.";
const ownerAuthorization = authorizationForStudentOwner(TEST_ANONYMOUS_OWNER);

beforeEach(() => {
  resetTutorSessionsForTests();
  resetTutorStateForTests();
  mockStudentOwner(TEST_ANONYMOUS_OWNER);
  vi.stubEnv("APP_DEMO_MODE", "true");
});
afterEach(() => {
  resetAuthMocks();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Phase A unreadable check boundaries", () => {
  it.each(["abc", "1/0", "0.1.2", "1 2"])(
    "does not penalize or disclose for %s",
    async (answer) => {
      const question = { ...(await getApprovedQuestionById("dice-sum-eight"))! };
      const base = getTutorSessionState("unreadable", question.id);
      const state = {
        ...base,
        attemptCount: 3,
        wrongAttemptCount: 2,
        hintsRevealed: question.hints.length,
        stepsRevealed: 1,
        lastMisconceptionIds: ["old-code"],
        lastAnswerFingerprint: "prior-answer",
      };
      expect(
        checkStudentAttempt(question, answer).misconception,
      ).toBeUndefined();
      const result = await decideTutorResponse({
        answer,
        mode: "check",
        allowLlmFallback: false,
        question,
        sessionId: state.sessionId,
        state,
      });
      expect(result.response).toMatchObject({
        source: "rule",
        verdict: "guidance",
        message,
        hints: [],
        steps: [],
        misconceptions: [],
        retrievedContext: [],
      });
      expect(result.state).toEqual({
        ...state,
        attemptCount: 4,
        state: "working",
      });
      expect(result.aiAccounting).toBeUndefined();
    },
  );

  it("grades a nonmatching text answer as incorrect rather than unreadable", async () => {
    const question = {
      ...(await getApprovedQuestionById("dice-sum-eight"))!,
      answer: {
        acceptedAnswers: ["Yes, independent"],
        explanation: "The events are independent.",
      },
      misconceptions: [],
    };
    const answer = "No, dependent";
    const state = getTutorSessionState("text-answer", question.id);
    expect(checkStudentAttempt(question, answer).answerCheck.outcome).toBe(
      "incorrect",
    );
    const result = await decideTutorResponse({
      answer,
      question,
      mode: "check",
      allowLlmFallback: false,
      sessionId: state.sessionId,
      state,
    });
    expect(result.response.verdict).toBe("incorrect");
    expect(result.response.message).not.toBe(message);
    expect(result.state.wrongAttemptCount).toBe(state.wrongAttemptCount + 1);
    expect(result.state.hintsRevealed).toBe(state.hintsRevealed + 1);
  });

  it("retrieves approved help for free text with AI fallback enabled after hints are exhausted", async () => {
    const question = (await getApprovedQuestionById("dice-sum-eight"))!;
    const state = {
      ...getTutorSessionState("free-text-coaching", question.id),
      hintsRevealed: question.hints.length,
    };
    const result = await decideTutorResponse({
      answer: "I am not sure how to express this setup.",
      question,
      mode: "check",
      allowLlmFallback: true,
      sessionId: state.sessionId,
      state,
    });
    expect(result.response.source).toBe("retrieval");
    expect(result.response.retrievedContext.length).toBeGreaterThan(0);
    expect(result.state.retrievalUsed).toBe(true);
  });

  it("uses the union-vs-intersection library feedback for unparseable numeric submissions", async () => {
    const question = {
      ...(await getApprovedQuestionById("dice-sum-eight"))!,
      topicId: "introduction-probability-venn-diagrams",
      misconceptions: [],
    };
    const answer = "I used P(A)+P(B) for the and event";
    const state = getTutorSessionState("union-misconception", question.id);
    expect(checkStudentAttempt(question, answer).misconception?.id).toBe(
      "union-vs-intersection",
    );
    const result = await decideTutorResponse({
      answer,
      question,
      mode: "check",
      allowLlmFallback: false,
      sessionId: state.sessionId,
      state,
    });
    expect(result.response.verdict).toBe("incorrect");
    expect(result.response.misconceptions[0]).toContain("union");
    expect(result.state.lastMisconceptionIds).toContain("union-vs-intersection");
    expect(result.state.wrongAttemptCount).toBe(state.wrongAttemptCount + 1);
    expect(result.state.hintsRevealed).toBe(state.hintsRevealed + 1);
  });

  it("rejects check answers over 500 characters before persisting an attempt", async () => {
    const session = await createTutorSession(
      ownerAuthorization,
      "dice-sum-eight",
    );
    const response = await POST(
      request({
        mode: "check",
        answer: " ".repeat(500) + "1",
        eventId: "too-long",
        sessionId: session.id,
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "MALFORMED_TUTOR_REQUEST",
    });
    expect(
      (await getTutorSession(ownerAuthorization, session.id))?.attempts,
    ).toEqual([]);
  });

  it("accepts a 500-character check and records unreadable guidance without a wrong attempt", async () => {
    const session = await createTutorSession(
      ownerAuthorization,
      "dice-sum-eight",
    );
    const response = await POST(
      request({
        mode: "check",
        answer: "a".repeat(500),
        allowLlmFallback: false,
        eventId: "at-limit",
        sessionId: session.id,
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      source: "rule",
      verdict: "guidance",
      message,
    });
    expect(await getTutorSession(ownerAuthorization, session.id)).toMatchObject(
      {
        attemptCount: 1,
        wrongAttemptCount: 0,
        revealedHints: 0,
        attempts: [
          expect.objectContaining({ mode: "check", verdict: "guidance" }),
        ],
      },
    );
  });
});

describe("topic-scoped library misconception matching", () => {
  const conditional = "conditional-probability-denominator-mistake";
  it.each(["normal-standardization", "conditional-probability", undefined])(
    "does not find the digit term 36 inside 0.136 in topic %s",
    (topicId) => {
      expect(
        detectMisconceptions({ studentAnswer: "0.136", topicId }).map(
          (match) => match.id,
        ),
      ).not.toContain(conditional);
    },
  );
  it("requires a matching topic and a complete digit token", () => {
    expect(
      detectMisconceptions({
        studentAnswer: "2/36",
        topicId: "conditional-probability",
      }).map((match) => match.id),
    ).toContain(conditional);
    expect(
      detectMisconceptions({
        studentAnswer: "2/36",
        topicId: "normal-standardization",
      }),
    ).toEqual([]);
    expect(
      detectMisconceptions({
        studentAnswer: "3 6",
        topicId: "conditional-probability",
      }),
    ).toEqual([]);
    expect(
      PROBABILITY_STATISTICS_MISCONCEPTIONS.every(
        (entry) => entry.topicIds.length > 0,
      ),
    ).toBe(true);
  });
  it("matches question-specific numeric terms by whole value and keeps their precedence", () => {
    const questionMisconceptions = [
      { id: "specific", matchTerms: ["36"], feedback: "Authored feedback" },
    ];
    // A digits-only term is a whole number or a fraction part, never a
    // decimal fragment: "36" does not fire inside 0.136 at question level.
    expect(
      detectMisconceptions({
        studentAnswer: "0.136",
        topicId: "normal-standardization",
        questionMisconceptions,
      }),
    ).toEqual([]);
    expect(
      detectMisconceptions({
        studentAnswer: "2/36",
        topicId: "conditional-probability",
        questionMisconceptions,
      }),
    ).toEqual([
      expect.objectContaining({
        id: "specific",
        source: "question",
        feedback: "Authored feedback",
      }),
    ]);
  });
});

function request(body: unknown) {
  return new Request("http://localhost/api/tutor/respond", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
