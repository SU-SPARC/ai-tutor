import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createOrResumeTutorSession,
  requestTutorResponse,
  TutorClientRequestError,
} from "@/components/tutor/practice-workspace";
import { anonymousTutorSessionStorageKey } from "@/lib/auth/anonymous-student";

const questionId = "question:recovery";
const sessionId = "session:durable";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
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

describe("tutor client recovery", () => {
  it("retains a known session and does not create another one during a transient outage", async () => {
    window.localStorage.setItem(
      anonymousTutorSessionStorageKey(questionId),
      sessionId,
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(serviceUnavailableResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(createOrResumeTutorSession(questionId)).rejects.toMatchObject({
      code: "DATA_SERVICE_UNAVAILABLE",
      status: 503,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.every(
        ([url, init]) =>
          url === `/api/tutor/session/${sessionId}` && init === undefined,
      ),
    ).toBe(true);
    expect(
      window.localStorage.getItem(anonymousTutorSessionStorageKey(questionId)),
    ).toBe(sessionId);
  });

  it("replaces only a safely concealed unavailable session", async () => {
    window.localStorage.setItem(
      anonymousTutorSessionStorageKey(questionId),
      "session:expired",
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          {
            code: "TUTOR_SESSION_UNAVAILABLE",
            error:
              "This tutor session is no longer available. It may have expired or its question may no longer be published.",
          },
          { status: 404 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json(
          { session: tutorSession("session:new") },
          { status: 201 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const session = await createOrResumeTutorSession(questionId);

    expect(session.id).toBe("session:new");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/tutor/session/session:expired",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/tutor/session");
    expect(
      window.localStorage.getItem(anonymousTutorSessionStorageKey(questionId)),
    ).toBe("session:new");
  });

  it("reuses one event id after network uncertainty so recovery is idempotent", async () => {
    const rawNetworkFailure = new TypeError(
      "socket closed with Authorization: secret-token",
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(rawNetworkFailure)
      .mockRejectedValueOnce(rawNetworkFailure)
      .mockResolvedValueOnce(Response.json(tutorResponse()));
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      answer: "0.5",
      mode: "check" as const,
      questionId,
      sessionId,
      topicId: "topic:probability",
    };

    let interrupted: unknown;
    try {
      await requestTutorResponse(input);
    } catch (error) {
      interrupted = error;
    }

    expect(interrupted).toBeInstanceOf(TutorClientRequestError);
    expect(interrupted).toMatchObject({
      code: "NETWORK_INTERRUPTED",
      status: 0,
    });
    expect(String(interrupted)).not.toMatch(
      /authorization|secret-token|socket/i,
    );

    const recovered = await requestTutorResponse(input);
    const requestBodies = fetchMock.mock.calls.map(
      ([, init]) => JSON.parse(String(init?.body)) as { eventId: string },
    );

    expect(recovered.verdict).toBe("guidance");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new Set(requestBodies.map((body) => body.eventId)).size).toBe(1);
    expect(
      window.localStorage.getItem(`ai-tutor:pending-event:${sessionId}`),
    ).toBeNull();
  });

  it("reuses one session-creation key after an interrupted create", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("connection lost after send"))
      .mockRejectedValueOnce(new TypeError("connection still unavailable"))
      .mockResolvedValueOnce(
        Response.json(
          { session: tutorSession("session:created-once") },
          { status: 201 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createOrResumeTutorSession(questionId)).rejects.toMatchObject({
      code: "NETWORK_INTERRUPTED",
      status: 0,
    });
    const recovered = await createOrResumeTutorSession(questionId);
    const requestBodies = fetchMock.mock.calls.map(
      ([, init]) =>
        JSON.parse(String(init?.body)) as { idempotencyKey: string },
    );

    expect(recovered.id).toBe("session:created-once");
    expect(new Set(requestBodies.map((body) => body.idempotencyKey)).size).toBe(
      1,
    );
    expect(
      window.localStorage.getItem(`ai-tutor:pending-session:${questionId}`),
    ).toBeNull();
  });

  it("never renders provider or database details from an unexpected server failure", async () => {
    const unsafe = Response.json(
      {
        code: "INTERNAL_FAILURE",
        error:
          "select answers from tutor_attempts at postgres://admin:secret@db.invalid",
      },
      { status: 500 },
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(unsafe)
      .mockResolvedValueOnce(
        Response.json(
          {
            code: "INTERNAL_FAILURE",
            error: "OpenRouter billing failed: sk-provider-secret",
          },
          { status: 500 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestTutorResponse({
        answer: "help",
        mode: "hint",
        questionId,
        sessionId,
        topicId: "topic:probability",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(TutorClientRequestError);
      expect(String(error)).toContain("temporarily unavailable");
      expect(String(error)).not.toMatch(
        /select|postgres|openrouter|billing|provider-secret/i,
      );
      return true;
    });
  });

  it("does not trust an unsafe error field in a malformed success response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          error:
            "select private_answer from attempts at postgres://admin:secret@db.invalid",
        }),
      ),
    );

    await expect(
      requestTutorResponse({
        answer: "help",
        mode: "hint",
        questionId,
        sessionId,
        topicId: "topic:probability",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(String(error)).toContain("could not complete this request");
      expect(String(error)).not.toMatch(
        /select|private_answer|postgres|admin:secret/i,
      );
      return true;
    });
  });
});

function serviceUnavailableResponse() {
  return Response.json(
    {
      code: "DATA_SERVICE_UNAVAILABLE",
      error: "The data service is temporarily unavailable.",
    },
    { status: 503 },
  );
}

function tutorSession(id: string) {
  return {
    aiFallbackUsed: false,
    attemptCount: 0,
    attempts: [],
    currentState: "working",
    id,
    questionId,
    revealedHints: 0,
    revealedSteps: 0,
    revision: 0,
    solved: false,
    wrongAttemptCount: 0,
  };
}

function tutorResponse() {
  return {
    hints: ["Use the definition first."],
    message: "Your saved session is ready.",
    misconceptions: [],
    retrievedContext: [],
    source: "rule",
    steps: [],
    usage: { contextUsed: false, fallbackUsed: false },
    verdict: "guidance",
  };
}
