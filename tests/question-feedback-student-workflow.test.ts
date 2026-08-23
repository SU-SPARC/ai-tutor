import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as submitFeedback } from "@/app/api/tutor/session/[sessionId]/feedback/route";
import {
  QUESTION_FEEDBACK_CATEGORY_LABELS,
  QuestionFeedbackForm,
} from "@/components/tutor/question-feedback-form";
import {
  getProfessorQuestionFeedbackDashboard,
  resetQuestionFeedbackForTests,
} from "@/lib/data/question-feedback-repository";
import {
  createTutorSession,
  resetTutorSessionsForTests,
} from "@/lib/data/tutor-session-repository";
import { QUESTION_FEEDBACK_CATEGORIES } from "@/lib/types";
import {
  authorizationForStudentOwner,
  mockPrincipal,
  mockStudentOwner,
  resetAuthMocks,
  TEST_ANONYMOUS_OWNER,
  TEST_PROFESSOR,
} from "./auth-test-helpers";
import { requireProfessorReview } from "@/lib/auth/authorization";

describe("student question feedback workflow", () => {
  beforeEach(() => {
    resetTutorSessionsForTests();
    resetQuestionFeedbackForTests();
    mockPrincipal(undefined);
    mockStudentOwner(TEST_ANONYMOUS_OWNER);
  });

  afterEach(() => {
    resetTutorSessionsForTests();
    resetQuestionFeedbackForTests();
    resetAuthMocks();
  });

  it("submits a minimal, redacted report linked to the owned tutor session and version", async () => {
    const session = await ownedSession();
    const response = await postReport(
      session.id,
      {
        category: "answer_appears_incorrect",
        details:
          "The result looks wrong. Contact me at student@example.edu or 617-555-0123. Token sk-abcdefghijklmnop.",
        idempotencyKey: "feedback:student-redaction",
      },
      "198.51.100.11",
    );
    const payload = (await response.json()) as {
      receipt: {
        acknowledgement: string;
        category: string;
        id: string;
        status: string;
      };
    };

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(payload.receipt).toMatchObject({
      acknowledgement: "Report received. Thank you for flagging it.",
      category: "answer_appears_incorrect",
      status: "open",
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /session|questionVersion|student@example|617-555|sk-abcdefghijklmnop/i,
    );

    mockPrincipal(TEST_PROFESSOR);
    const dashboard = await getProfessorQuestionFeedbackDashboard(
      await requireProfessorReview(),
    );
    expect(dashboard.reports).toHaveLength(1);
    expect(dashboard.reports[0]).toMatchObject({
      category: "answer_appears_incorrect",
      questionId: "dice-sum-eight",
      questionVersionId: session.questionVersionId,
      status: "open",
      tutorSessionId: session.id,
    });
    expect(dashboard.reports[0].message).toContain("[email removed]");
    expect(dashboard.reports[0].message).toContain("[number removed]");
    expect(dashboard.reports[0].message).toContain("[secret removed]");
    expect(JSON.stringify(dashboard)).not.toMatch(
      /reporterSubjectHash|student@example|617-555|sk-abcdefghijklmnop/i,
    );
  });

  it("conceals another student's session and keeps it unchanged", async () => {
    const session = await ownedSession();
    mockStudentOwner({
      anonymousId: "anon:another-browser",
      kind: "anonymous",
    });

    const response = await postReport(
      session.id,
      {
        category: "technical_problem",
        idempotencyKey: "feedback:cross-student",
      },
      "198.51.100.12",
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Tutor session was not found.",
    });

    mockPrincipal(TEST_PROFESSOR);
    const dashboard = await getProfessorQuestionFeedbackDashboard(
      await requireProfessorReview(),
    );
    expect(dashboard.reports).toEqual([]);
  });

  it("makes retries idempotent and limits repeated reports", async () => {
    const session = await ownedSession();
    const body = {
      category: "hint_unhelpful",
      details: "The first hint repeats the prompt.",
      idempotencyKey: "feedback:retry",
    };

    const first = await postReport(session.id, body, "198.51.100.13");
    const retry = await postReport(session.id, body, "198.51.100.13");
    const second = await postReport(
      session.id,
      { ...body, idempotencyKey: "feedback:second" },
      "198.51.100.13",
    );
    const limited = await postReport(
      session.id,
      { ...body, idempotencyKey: "feedback:third" },
      "198.51.100.13",
    );
    const [firstPayload, retryPayload] = await Promise.all([
      first.json() as Promise<{ receipt: { id: string } }>,
      retry.json() as Promise<{ receipt: { id: string } }>,
    ]);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retryPayload.receipt.id).toBe(firstPayload.receipt.id);
    expect(second.status).toBe(201);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
  });

  it("renders all required categories and asks students not to provide personal data", () => {
    const markup = renderToStaticMarkup(
      createElement(QuestionFeedbackForm, {
        questionTitle: "Probability question",
        sessionId: "session:student-ui",
      }),
    );

    for (const category of QUESTION_FEEDBACK_CATEGORIES) {
      expect(markup).toContain(`value="${category}"`);
      expect(markup).toContain(QUESTION_FEEDBACK_CATEGORY_LABELS[category]);
    }
    expect(markup).toContain("Report a problem");
    expect(markup).toContain("Details (optional)");
    expect(markup).toContain("Do not include your name, email, student ID");
    expect(markup).not.toMatch(/name="(name|email|studentId|phone)"/i);
  });
});

async function ownedSession() {
  return createTutorSession(
    authorizationForStudentOwner(TEST_ANONYMOUS_OWNER),
    "dice-sum-eight",
    `session:${crypto.randomUUID()}`,
  );
}

function postReport(sessionId: string, body: unknown, forwardedFor: string) {
  return submitFeedback(
    new Request(`http://test/api/tutor/session/${sessionId}/feedback`, {
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": forwardedFor,
      },
      method: "POST",
    }),
    { params: Promise.resolve({ sessionId }) },
  );
}
