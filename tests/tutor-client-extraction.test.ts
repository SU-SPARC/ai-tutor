import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as tutorClient from "@/components/tutor/tutor-client";
import * as practiceWorkspace from "@/components/tutor/practice-workspace";
import { sheetProgressFromResponse } from "@/components/tutor/use-sheet-session";
import { anonymousTutorSessionStorageKey } from "@/lib/auth/anonymous-student";
import type { TutorResponse } from "@/lib/types";

const questionId = "question:extraction";
const sessionId = "session:extraction";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    location: { pathname: "/", search: "" },
    localStorage: {
      getItem(key: string) {
        return values.get(key) ?? null;
      },
      removeItem(key: string) {
        values.delete(key);
      },
      setItem(key: string, value: string) {
        values.set(key, value);
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("tutor client extraction", () => {
  it("re-exports the moved client helpers from practice-workspace", () => {
    // The helpers now live in ./tutor-client. Every importer that predates the
    // move (the recovery, usage-indicator, AI-help and student-flow tests)
    // keeps resolving through practice-workspace, and gets the same function.
    expect(practiceWorkspace.responseUsageStatusText).toBe(
      tutorClient.responseUsageStatusText,
    );
    expect(practiceWorkspace.shouldShowRetrievedContext).toBe(
      tutorClient.shouldShowRetrievedContext,
    );
    expect(practiceWorkspace.chatMessageForResponse).toBe(
      tutorClient.chatMessageForResponse,
    );
    expect(practiceWorkspace.nextQuestionAfter).toBe(
      tutorClient.nextQuestionAfter,
    );
    expect(practiceWorkspace.recoveryMessages).toBe(
      tutorClient.recoveryMessages,
    );
    expect(practiceWorkspace.requestTutorResponse).toBe(
      tutorClient.requestTutorResponse,
    );
    expect(practiceWorkspace.createOrResumeTutorSession).toBe(
      tutorClient.createOrResumeTutorSession,
    );
    expect(practiceWorkspace.TutorClientRequestError).toBe(
      tutorClient.TutorClientRequestError,
    );
    expect(practiceWorkspace.SIGN_IN_REQUIRED_CODE).toBe(
      tutorClient.SIGN_IN_REQUIRED_CODE,
    );
    expect(practiceWorkspace.SIGN_IN_REQUIRED_MESSAGE).toBe(
      tutorClient.SIGN_IN_REQUIRED_MESSAGE,
    );
    expect(tutorClient.sendTutorRequest).toBe(tutorClient.requestTutorResponse);
  });

  // There is no DOM test environment in this repo (vitest runs in "node" with
  // no jsdom/happy-dom and no @testing-library), so `useSheetSession` cannot be
  // driven with renderHook. Its network path and its pure response mapping are
  // exercised directly instead.
  it("creates a session then maps a correct check the way the sheet hook does", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(201, { session: createdSessionDto() }),
      )
      .mockResolvedValueOnce(jsonResponse(200, correctCheckResponse()));
    vi.stubGlobal("fetch", fetchMock);

    const session = await tutorClient.createTutorSession(questionId);
    tutorClient.storeTutorSessionId(questionId, session.id);

    expect(session.id).toBe(sessionId);
    expect(
      window.localStorage.getItem(anonymousTutorSessionStorageKey(questionId)),
    ).toBe(sessionId);

    const [createUrl, createInit] = fetchMock.mock.calls[0]!;
    expect(createUrl).toBe("/api/tutor/session");
    const createBody = JSON.parse(String(createInit?.body)) as {
      idempotencyKey?: unknown;
      questionId?: unknown;
    };
    expect(createBody.questionId).toBe(questionId);
    expect(typeof createBody.idempotencyKey).toBe("string");

    const response = await tutorClient.sendTutorRequest({
      answer: "0.5",
      mode: "check",
      questionId,
      sessionId: session.id,
      topicId: "topic:probability",
    });

    const [respondUrl, respondInit] = fetchMock.mock.calls[1]!;
    expect(respondUrl).toBe("/api/tutor/respond");
    const respondBody = JSON.parse(String(respondInit?.body)) as {
      answer?: unknown;
      eventId?: unknown;
      mode?: unknown;
      sessionId?: unknown;
    };
    expect(respondBody).toMatchObject({
      answer: "0.5",
      mode: "check",
      sessionId,
    });
    expect(typeof respondBody.eventId).toBe("string");

    const progress = sheetProgressFromResponse(response, 2);
    expect(progress.verdict).toBe("correct");
    expect(progress.solved).toBe(true);
    expect(progress.lastMessage).toBe("That is right.");
    expect(progress.hintsRevealed).toEqual(["Start with the complement."]);
    expect(progress.attemptCount).toBe(1);

    const updated = tutorClient.sessionWithProgress(session, response);
    expect(updated?.solved).toBe(true);
    expect(updated?.attemptCount).toBe(1);
  });

  it("turns a sign-in requirement into readable sheet error state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(401, {})),
    );

    const failure = await tutorClient
      .createTutorSession(questionId)
      .catch((error: unknown) => error);

    const state = tutorClient.sessionErrorFor(failure);
    expect(state.code).toBe(tutorClient.SIGN_IN_REQUIRED_CODE);
    expect(state.message).toBe(tutorClient.SIGN_IN_REQUIRED_MESSAGE);
    expect(state.signInHref).toBeTruthy();
  });
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function createdSessionDto() {
  return {
    aiFallbackUsed: false,
    attemptCount: 0,
    attempts: [],
    currentState: "working",
    id: sessionId,
    practiceContext: "published",
    questionId,
    revealedHints: 0,
    revealedSteps: 0,
    revision: 0,
    solved: false,
    wrongAttemptCount: 0,
  };
}

function correctCheckResponse(): TutorResponse {
  return {
    hints: ["Start with the complement.", "Then subtract from one."],
    message: "That is right.",
    misconceptions: [],
    progress: {
      attemptCount: 1,
      hintsRevealed: 1,
      llmUsed: false,
      retrievalUsed: false,
      solved: true,
      state: "solved",
      stepsRevealed: 0,
      wrongAttemptCount: 0,
    },
    responseLabel: "approved_course_content",
    retrievedContext: [],
    source: "rule",
    steps: [],
    usage: {
      contextUsed: false,
      estimatedTokens: 12,
      fallbackUsed: false,
    },
    verdict: "correct",
  };
}
