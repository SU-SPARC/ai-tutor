import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/tutor/respond/route";
import {
  AI_HELP_DEFAULT_MESSAGE,
  AI_HELP_REQUEST_TEXT,
  aiHelpMessageFor,
  aiHelpStateKey,
  appendAiHelpReply,
  createAiHelpGate,
  withoutEntry,
  type TranscriptEntry,
} from "@/components/tutor/ai-help-request";
import {
  chatMessageForResponse,
  requestTutorResponse,
  TutorClientRequestError,
} from "@/components/tutor/practice-workspace";
import { toTutorResponseDto } from "@/lib/api/tutor-response-dto";
import { resetAiUsageControlsForTests } from "@/lib/ai/usage-controls";
import { setContentRepositoryForTests } from "@/lib/data/data-store";
import type { ContentRepository } from "@/lib/data/repository";
import {
  createTutorSession,
  getTutorSession,
  resetTutorSessionsForTests,
} from "@/lib/data/tutor-session-repository";
import {
  findRepeatedAiHelpAttempt,
  REPEATED_AI_HELP_MESSAGE,
} from "@/lib/tutor/ai-help-repeat";
import { normalizedTutorAnswerForPersistence } from "@/lib/tutor/session-persistence";
import {
  retrievalGuidanceForStudent,
  scrubInternalIdentifiers,
} from "@/lib/tutor/student-guidance";
import { createTutorResponse } from "@/lib/tutor/tutor-engine";
import { resetTutorStateForTests } from "@/lib/tutor/tutor-state";
import type {
  CourseTopic,
  TutorQuestion,
  TutorResponse,
  TutorSessionAttempt,
} from "@/lib/types";
import remediated from "../data/demo/remediated-syllabus-review-candidates.json";
import syllabus from "../data/demo/syllabus-review-candidates.json";
import {
  authorizationForStudentOwner,
  mockStudentOwner,
  resetAuthMocks,
  TEST_ANONYMOUS_OWNER,
} from "./auth-test-helpers";

/** Anything a student must never read in tutor copy. */
const INTERNAL_TERMS =
  /misconception-[a-z0-9-]+|question-chunk|Feedback:|Trigger:|Watch for:|approved course pattern|provenance|priorityTier|trustLevel|reviewStatus|professor_approved|generated_original|retrieval|fallback|provider|chunk/i;

const STUCK = "I'm stuck and not sure how to proceed.";
const TRANSIT_CHUNK_BODY =
  "Misconception misconception-addition-transit: Feedback: Subtract the intersection once so outcomes in both events are not counted twice.";
const EXPECTED_TRANSIT_GUIDANCE =
  "Here's another way to think about it: Subtract the intersection once so outcomes in both events are not counted twice.";

// ---------------------------------------------------------------------------
// Production-like content: the published "Bus or Rail" addition-rule question
// (whose misconception chunk leaked) next to the P(A) = 0.45 question.
// ---------------------------------------------------------------------------

function published(candidate: TutorQuestion): TutorQuestion {
  return {
    ...candidate,
    review: { status: "approved" },
    source: { ...candidate.source, trustLevel: "professor_approved" },
  };
}

const currentQuestion = published(
  (remediated as TutorQuestion[]).find(
    (question) => question.id === "generated-syllabus-addition-calendar-v2",
  )!,
);
const siblingQuestion = published(
  (syllabus as TutorQuestion[]).find(
    (question) => question.id === "generated-syllabus-addition-transit",
  )!,
);
const axiomsTopic: CourseTopic = {
  active: true,
  description: "Axioms of probability and counting.",
  id: "axioms-probability-counting-methods",
  moduleRef: "Week 1",
  order: 1,
  title: "Axioms of Probability and Counting Methods",
  weekNumber: 1,
};

function productionLikeRepository(): ContentRepository {
  const questions = [currentQuestion, siblingQuestion];
  return {
    async getAdminQuestions() {
      return [];
    },
    async getApprovedQuestionById(id: string) {
      return questions.find((question) => question.id === id);
    },
    async getApprovedQuestions() {
      return questions;
    },
    async getQuestionById(id: string) {
      return questions.find((question) => question.id === id);
    },
    async getQuestionCounts() {
      return { byTopic: {}, total: 0 };
    },
    async getProfessorPracticeAnalytics() {
      return {
        generatedQuestionOutcomes: {
          approved: 0,
          needs_edit: 0,
          needs_regeneration: 0,
          needs_review: 0,
          rejected: 0,
        },
        mode: "demo",
        questions: [],
        summary: {
          totalAttempts: 0,
          totalHintsUsed: 0,
          totalStepsRevealed: 0,
          totalTutorSessions: 0,
        },
        topics: [],
      };
    },
    async getRetrievalChunks() {
      return [];
    },
    async getReviewQueue() {
      return [];
    },
    async getTopics() {
      return [axiomsTopic];
    },
    async listQuestions() {
      return questions;
    },
    async listQuestionsByTopic() {
      return questions;
    },
    async listTopics() {
      return [axiomsTopic];
    },
    async importReviewCandidates() {
      return {
        candidates: [],
        imported: true,
        message: "Imported into test repository.",
        mode: "demo",
        nonDurable: true,
      };
    },
    async updateReviewCandidates() {
      return [];
    },
    async updateAdminQuestions() {
      return [];
    },
    async updateAdminQuestionDetail() {
      return undefined;
    },
    async regenerateAdminQuestion() {
      return undefined;
    },
    async updateReviewCandidateStatus() {
      return undefined;
    },
  } as unknown as ContentRepository;
}

async function exhaustEngineHints(sessionId: string) {
  for (let index = 0; index < currentQuestion.hints.length; index += 1) {
    await createTutorResponse({
      answer: "",
      mode: "hint",
      questionId: currentQuestion.id,
      sessionId,
    });
  }
}

describe("student AI help: approved fallback copy (screenshot case)", () => {
  beforeEach(() => {
    resetTutorStateForTests();
    resetAiUsageControlsForTests();
    setContentRepositoryForTests(productionLikeRepository());
    vi.stubEnv("AI_ENABLED", "false");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    setContentRepositoryForTests(undefined);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("answers from approved course material as tutoring language, with no internal ids and no provider call", async () => {
    await exhaustEngineHints("copy-1");

    const response = await createTutorResponse({
      allowLlmFallback: true,
      answer: STUCK,
      mode: "check",
      questionId: currentQuestion.id,
      sessionId: "copy-1",
    });
    const dto = JSON.stringify(toTutorResponseDto(response));

    expect(response.source).toBe("retrieval");
    expect(response.verdict).toBe("guidance");
    expect(response.progress?.llmUsed).toBe(false);
    expect(response.message).toMatch(/^(Here's|Compare with)/);
    expect(response.message).toMatch(/intersection|union|A or B/);
    expect(response.message).not.toMatch(INTERNAL_TERMS);
    expect(response.hints).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(dto).not.toContain("misconception-addition-transit");
    expect(dto).not.toContain("question-chunk:");
    expect(dto).not.toContain(siblingQuestion.title);
    expect(dto).not.toMatch(/professor_approved|priorityTier|trustLevel/);
  });

  it("renders the leaked Production chunk as the intended student sentence", () => {
    expect(
      retrievalGuidanceForStudent({
        body: TRANSIT_CHUNK_BODY,
        chunkType: "misconception",
      }),
    ).toBe(EXPECTED_TRANSIT_GUIDANCE);
  });

  it("keeps every retrieval chunk kind pedagogically useful and prefix-free", () => {
    const cases: Array<
      [string, TutorResponse["retrievedContext"][number]["chunkType"], string]
    > = [
      [
        "Misconception misconception-addition-transit: Trigger: added P(A) and P(B) only. Watch for: 0.83, 83%. Feedback: Subtract the intersection once.",
        "misconception",
        "Here's another way to think about it: Subtract the intersection once.",
      ],
      [
        "Hint 2: Write the relevant counts or probabilities before calculating.",
        "hint",
        "Here's a hint from a similar problem: Write the relevant counts or probabilities before calculating.",
      ],
      [
        "Question: Two events A and B are disjoint, with P(A) = 0.27 and P(B) = 0.31. What is P(A union B)?",
        "question",
        "Compare with this related problem: Two events A and B are disjoint, with P(A) = 0.27 and P(B) = 0.31. What is P(A union B)?",
      ],
      [
        "Solution step 1: Use P(A union B) = P(A) + P(B) - P(A intersection B).",
        "solution_step",
        "Here's how a related problem is solved: Use P(A union B) = P(A) + P(B) - P(A intersection B).",
      ],
      [
        "Solution summary: Therefore P(A union B) = 0.69. Final answer: 0.69",
        "solution_summary",
        "Here's how a related problem is solved: Therefore P(A union B) = 0.69. Final answer: 0.69",
      ],
      [
        "For P(A | B), first restrict attention to outcomes where B occurred.",
        "concept",
        "Here's a related idea from the course: For P(A | B), first restrict attention to outcomes where B occurred.",
      ],
    ];

    for (const [body, chunkType, expected] of cases) {
      const guidance = retrievalGuidanceForStudent({ body, chunkType });
      expect(guidance).toBe(expected);
      expect(guidance).not.toMatch(INTERNAL_TERMS);
    }
  });

  it("scrubs misconception slugs and chunk ids from any student-visible field", () => {
    expect(
      scrubInternalIdentifiers(
        "See misconception-addition-transit (question-chunk:generated-syllabus-addition-transit:misconception-misconception-addition-transit) and subtract once.",
      ),
    ).toBe("See and subtract once.");
    expect(scrubInternalIdentifiers("Subtract P(A and B) = 0.20 once.")).toBe(
      "Subtract P(A and B) = 0.20 once.",
    );

    const dto = toTutorResponseDto({
      hints: ["Hint mentioning misconception-addition-transit."],
      message:
        "Recall misconception-addition-calendar-overlap-not-subtracted here.",
      misconceptions: ["Feedback with question-chunk:abc:def inside."],
      retrievedContext: [],
      source: "llm",
      steps: [],
      usage: { contextUsed: true, estimatedTokens: 5, fallbackUsed: true },
      verdict: "guidance",
    });

    expect(JSON.stringify(dto)).not.toMatch(
      /misconception-[a-z0-9-]+|question-chunk:/,
    );
    expect(dto.message).toBe("Recall here.");
  });
});

// ---------------------------------------------------------------------------
// Server: one request per tutoring state, provider calls counted.
// ---------------------------------------------------------------------------

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

function mockLlmResponse(text: string): FetchMock {
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  schemaVersion: 1,
                  pedagogicalAction: "hint",
                  message: text,
                }),
              },
            },
          ],
          usage: { completion_tokens: 20, prompt_tokens: 50, total_tokens: 70 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  );
  vi.stubEnv("AI_ENABLED", "true");
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/tutor/respond", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

describe("student AI help: same-state requests never repeat work", () => {
  const studentAuthorization =
    authorizationForStudentOwner(TEST_ANONYMOUS_OWNER);

  beforeEach(() => {
    resetTutorSessionsForTests();
    resetTutorStateForTests();
    resetAiUsageControlsForTests();
    mockStudentOwner(TEST_ANONYMOUS_OWNER);
    vi.stubEnv("APP_DEMO_MODE", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetAuthMocks();
  });

  async function sessionWithHintsExhausted() {
    const session = await createTutorSession(
      studentAuthorization,
      "dice-sum-eight",
    );
    for (let index = 0; index < 3; index += 1) {
      const hint = await POST(
        jsonRequest({
          answer: "",
          eventId: `event:hint-${index}`,
          mode: "hint",
          questionId: "dice-sum-eight",
          sessionId: session.id,
        }),
      );
      expect(hint.status).toBe(200);
    }
    return session;
  }

  function askForHelp(sessionId: string, eventId: string, answer = STUCK) {
    return POST(
      jsonRequest({
        allowLlmFallback: true,
        answer,
        eventId,
        mode: "check",
        questionId: "dice-sum-eight",
        sessionId,
      }),
    );
  }

  it("one request records one attempt; a same-state repeat reuses it without a transition or provider call", async () => {
    const fetchImpl = mockLlmResponse(
      "Provider text that must not be requested.",
    );
    const session = await sessionWithHintsExhausted();

    const first = await askForHelp(session.id, "event:help-1");
    const firstBody = (await first.json()) as TutorResponse;
    const afterFirst = await getTutorSession(studentAuthorization, session.id);
    const repeat = await askForHelp(session.id, "event:help-2");
    const repeatBody = (await repeat.json()) as TutorResponse;
    const afterRepeat = await getTutorSession(studentAuthorization, session.id);
    const replayed = await askForHelp(session.id, "event:help-1");

    expect(first.status).toBe(200);
    expect(firstBody.source).toBe("retrieval");
    expect(firstBody.message).not.toMatch(INTERNAL_TERMS);
    expect(afterFirst?.attempts).toHaveLength(4);
    expect(repeat.status).toBe(200);
    expect(repeatBody).toMatchObject({
      message: REPEATED_AI_HELP_MESSAGE,
      source: "rule",
      verdict: "guidance",
    });
    expect(repeatBody.message).not.toMatch(INTERNAL_TERMS);
    expect(repeatBody.progress?.attemptCount).toBe(afterFirst?.attemptCount);
    expect(afterRepeat?.attempts).toHaveLength(4);
    expect(afterRepeat?.revision).toBe(afterFirst?.revision);
    expect(replayed.status).toBe(200);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a meaningful state change allows new help, reaching the provider once; the next same-state repeat does not", async () => {
    const fetchImpl = mockLlmResponse(
      "Try listing the ordered outcomes whose sum is 8, then count those with a 3.",
    );
    const session = await sessionWithHintsExhausted();

    const retrievalHelp = await askForHelp(session.id, "event:help-1");
    const newAttempt = await POST(
      jsonRequest({
        answer: "1/2",
        eventId: "event:check-1",
        mode: "check",
        questionId: "dice-sum-eight",
        sessionId: session.id,
      }),
    );
    const llmHelp = await askForHelp(session.id, "event:help-2");
    const llmBody = (await llmHelp.json()) as TutorResponse;
    const repeat = await askForHelp(session.id, "event:help-3");
    const repeatBody = (await repeat.json()) as TutorResponse;
    const saved = await getTutorSession(studentAuthorization, session.id);

    expect(((await retrievalHelp.json()) as TutorResponse).source).toBe(
      "retrieval",
    );
    expect(((await newAttempt.json()) as TutorResponse).verdict).toBe(
      "incorrect",
    );
    expect(llmHelp.status).toBe(200);
    expect(llmBody.source).toBe("llm");
    expect(llmBody.message).toContain("ordered outcomes");
    expect(llmBody.message).not.toMatch(INTERNAL_TERMS);
    expect(repeatBody.message).toBe(REPEATED_AI_HELP_MESSAGE);
    expect(saved?.attempts).toHaveLength(6);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("with AI disabled, approved material still answers and a repeat stays a no-op", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    vi.stubEnv("AI_ENABLED", "false");
    vi.stubGlobal("fetch", fetchImpl);
    const session = await sessionWithHintsExhausted();

    const first = await askForHelp(session.id, "event:help-1");
    const firstBody = (await first.json()) as TutorResponse;
    const repeat = await askForHelp(session.id, "event:help-2");
    const repeatBody = (await repeat.json()) as TutorResponse;
    const saved = await getTutorSession(studentAuthorization, session.id);

    expect(firstBody.source).toBe("retrieval");
    expect(firstBody.message).not.toMatch(INTERNAL_TERMS);
    expect(repeatBody.message).toBe(REPEATED_AI_HELP_MESSAGE);
    expect(saved?.attempts).toHaveLength(4);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("matches a repeat only when the last completed attempt is the same AI-help exchange", () => {
    const helpAttempt: TutorSessionAttempt = {
      createdAt: "2026-09-10T00:00:00.000Z",
      id: "attempt-help",
      mode: "check",
      normalizedAnswer: normalizedTutorAnswerForPersistence(STUCK),
      source: "retrieval",
      submittedAnswer: STUCK,
      verdict: "guidance",
    };
    const checkAttempt: TutorSessionAttempt = {
      ...helpAttempt,
      id: "attempt-check",
      normalizedAnswer: "1/2",
      source: "rule",
      submittedAnswer: "1/2",
      verdict: "incorrect",
    };
    const request = { answer: STUCK, mode: "check" as const };

    expect(
      findRepeatedAiHelpAttempt({ attempts: [helpAttempt] }, request),
    ).toBe(helpAttempt);
    expect(
      findRepeatedAiHelpAttempt(
        {
          attempts: [
            helpAttempt,
            { ...helpAttempt, id: "pending", verdict: undefined },
          ],
        },
        request,
      ),
    ).toBe(helpAttempt);
    expect(
      findRepeatedAiHelpAttempt(
        { attempts: [helpAttempt, checkAttempt] },
        request,
      ),
    ).toBeUndefined();
    expect(
      findRepeatedAiHelpAttempt(
        { attempts: [helpAttempt] },
        { ...request, answer: "0.83" },
      ),
    ).toBeUndefined();
    expect(
      findRepeatedAiHelpAttempt(
        { attempts: [helpAttempt] },
        { ...request, mode: "hint" },
      ),
    ).toBeUndefined();
    expect(
      findRepeatedAiHelpAttempt(
        {
          attempts: [{ ...helpAttempt, source: "blocked", verdict: "blocked" }],
        },
        request,
      ),
    ).toBeUndefined();
    expect(
      findRepeatedAiHelpAttempt({ attempts: [] }, request),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Client: one click, one in-flight request, one reply, clean failure.
// ---------------------------------------------------------------------------

function helpInput() {
  return {
    allowLlmFallback: true,
    answer: STUCK,
    mode: "check" as const,
    questionId: "question:addition",
    sessionId: "session:addition",
    topicId: "axioms-probability-counting-methods",
  };
}

function retrievalReply(): TutorResponse {
  return {
    hints: [],
    message: EXPECTED_TRANSIT_GUIDANCE,
    misconceptions: [],
    progress: {
      attemptCount: 4,
      hintsRevealed: 3,
      llmUsed: false,
      retrievalUsed: true,
      solved: false,
      state: "retrieval_guidance",
      stepsRevealed: 0,
      wrongAttemptCount: 0,
    },
    responseLabel: "generated_approved_content",
    retrievedContext: [],
    source: "retrieval",
    steps: [],
    usage: {
      contextUsed: true,
      estimatedTokens: 0,
      fallbackUsed: false,
      llmFallbackEligible: true,
    },
    verdict: "guidance",
  };
}

function okResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

function serviceUnavailable() {
  return new Response(
    JSON.stringify({
      code: "DATA_SERVICE_UNAVAILABLE",
      error: "postgres://operator:secret@db.invalid refused",
    }),
    { headers: { "Content-Type": "application/json" }, status: 503 },
  );
}

function pendingRequest(id: string): TranscriptEntry {
  return { id, role: "student", text: AI_HELP_REQUEST_TEXT };
}

describe("student AI help: client guards", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => {
          values.delete(key);
        },
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("one click sends exactly one request and renders exactly one reply", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(okResponse(retrievalReply()));
    vi.stubGlobal("fetch", fetchImpl);
    const gate = createAiHelpGate();

    const run = await gate.run(() => requestTutorResponse(helpInput()));
    if (!run.started) {
      throw new Error("Expected the first click to start a request.");
    }
    const transcript = appendAiHelpReply([pendingRequest("s1")], "s1", {
      ...chatMessageForResponse(run.value),
      id: "t1",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(transcript.map((entry) => entry.role)).toEqual(["student", "tutor"]);
    expect(transcript[1]?.text).toBe(EXPECTED_TRANSIT_GUIDANCE);
    expect(transcript[1]?.text).not.toMatch(INTERNAL_TERMS);
  });

  it("a rapid double click keeps a single request in flight", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchImpl);
    const gate = createAiHelpGate();

    const first = gate.run(() => requestTutorResponse(helpInput()));
    const second = gate.run(() => requestTutorResponse(helpInput()));

    expect(gate.inFlight).toBe(true);
    await expect(second).resolves.toEqual({ started: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    resolveFetch?.(okResponse(retrievalReply()));
    await expect(first).resolves.toMatchObject({ started: true });
    expect(gate.inFlight).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never appends the same reply twice for an unchanged state", () => {
    const reply: TranscriptEntry = {
      id: "t1",
      role: "tutor",
      text: EXPECTED_TRANSIT_GUIDANCE,
    };
    const once = appendAiHelpReply([pendingRequest("s1")], "s1", reply);
    const again = appendAiHelpReply([...once, pendingRequest("s2")], "s2", {
      ...reply,
      id: "t2",
    });

    expect(once.map((entry) => entry.role)).toEqual(["student", "tutor"]);
    expect(again).toEqual(once);
  });

  it("keys the tutoring state so only a meaningful change re-enables help", () => {
    const base = {
      answer: "",
      attemptCount: 4,
      hintsRevealed: 3,
      questionId: "question:addition",
      sessionId: "session:addition",
      solved: false,
      stepsRevealed: 0,
    };

    expect(aiHelpMessageFor("  ")).toBe(AI_HELP_DEFAULT_MESSAGE);
    expect(aiHelpMessageFor(" 0.83 ")).toBe("0.83");
    expect(aiHelpStateKey(base)).toBe(
      aiHelpStateKey({ ...base, answer: "   " }),
    );
    expect(aiHelpStateKey(base)).toBe(
      aiHelpStateKey({ ...base, answer: AI_HELP_DEFAULT_MESSAGE }),
    );
    for (const change of [
      { attemptCount: 5 },
      { answer: "0.83" },
      { hintsRevealed: 2 },
      { stepsRevealed: 1 },
      { solved: true },
      { questionId: "question:other" },
      { sessionId: "session:other" },
    ]) {
      expect(aiHelpStateKey({ ...base, ...change })).not.toBe(
        aiHelpStateKey(base),
      );
    }
  });

  it("a failed request withdraws the pending bubble, hides internals, and a retry yields one clean exchange", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(serviceUnavailable())
      .mockResolvedValueOnce(serviceUnavailable())
      .mockResolvedValueOnce(okResponse(retrievalReply()));
    vi.stubGlobal("fetch", fetchImpl);
    const gate = createAiHelpGate();
    let transcript: TranscriptEntry[] = [pendingRequest("s1")];

    const failure = await gate
      .run(() => requestTutorResponse(helpInput()))
      .catch((error: unknown) => error);
    transcript = withoutEntry(transcript, "s1");

    expect(failure).toBeInstanceOf(TutorClientRequestError);
    expect((failure as TutorClientRequestError).message).not.toMatch(
      /postgres|operator|secret|provider|openrouter/i,
    );
    expect(gate.inFlight).toBe(false);
    expect(transcript).toEqual([]);

    transcript = [...transcript, pendingRequest("s2")];
    const retry = await gate.run(() => requestTutorResponse(helpInput()));
    if (!retry.started) {
      throw new Error("Expected the retry to start a request.");
    }
    transcript = appendAiHelpReply(transcript, "s2", {
      ...chatMessageForResponse(retry.value),
      id: "t1",
    });
    const eventIds = fetchImpl.mock.calls.map(
      ([, init]) =>
        (JSON.parse(String(init?.body)) as { eventId: string }).eventId,
    );

    expect(transcript.map((entry) => entry.role)).toEqual(["student", "tutor"]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(new Set(eventIds).size).toBe(1);
  });
});
