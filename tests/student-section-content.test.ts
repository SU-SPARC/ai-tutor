import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as listQuestionsRoute } from "@/app/api/questions/route";
import { POST as postTutorResponse } from "@/app/api/tutor/respond/route";
import { POST as postSession } from "@/app/api/tutor/session/route";
import { GET as getSessionRoute } from "@/app/api/tutor/session/[sessionId]/route";
import { PracticeWorkspace } from "@/components/tutor/practice-workspace";
import { normalizeSummary } from "@/lib/api/question-serialization";
import type { DeliverySettings } from "@/lib/courses/types";
import type {
  CoursesRepository,
  SectionReleaseDto,
  StudentSectionDto,
} from "@/lib/data/courses-repository";
import {
  getApprovedQuestionById,
  getTopics,
  setCoursesRepositoryForTests,
} from "@/lib/data/data-store";
import { resetTutorSessionsForTests } from "@/lib/data/tutor-session-repository";
import {
  attemptsRemaining,
  deliveryRefusal,
  findVisibleSectionRelease,
  isSectionReleaseVisible,
  parseJoinCode,
  sectionDeliveryByQuestionId,
  selectSectionQuestions,
  selectSectionTopics,
  solutionRevealAllowed,
  visibleSectionReleases,
  withPinnedQuestions,
} from "@/lib/tutor/section-content";
import {
  mockPrincipal,
  mockStudentOwner,
  resetAuthMocks,
  TEST_ANONYMOUS_OWNER,
} from "./auth-test-helpers";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const OPEN_DELIVERY: DeliverySettings = {
  attemptsAllowed: 3,
  hintsEnabled: true,
  solutionReveal: "after_2_wrong",
};

const SECTION: StudentSectionDto = {
  courseCode: "MATH-255",
  courseId: "course-math-255",
  courseTitle: "Probability and Statistics",
  joinedAt: "2026-09-02T14:00:00.000Z",
  sectionId: "section-1",
  sectionLabel: "Section 1",
  term: "Fall 2026",
};

function release(
  questionId: string,
  overrides: Partial<SectionReleaseDto> = {},
): SectionReleaseDto {
  return {
    delivery: OPEN_DELIVERY,
    position: 0,
    questionId,
    questionVersionId: 1,
    releasedVersion: 1,
    topicId: "conditional-probability",
    topicPosition: 0,
    topicState: "open",
    ...overrides,
  };
}

function useSectionReleases(releases: SectionReleaseDto[] | undefined) {
  const repository = {
    applyProfessorAction: vi.fn(),
    getSectionReleases: vi.fn(async () => releases ?? []),
    getStudentSection: vi.fn(async () => (releases ? SECTION : undefined)),
    joinSection: vi.fn(),
    leaveSection: vi.fn(),
    loadProfessorState: vi.fn(),
  };
  setCoursesRepositoryForTests(repository as unknown as CoursesRepository);
  return repository;
}

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

describe("section content rules", () => {
  it("shows a release while its topic is open, or scheduled and already open", () => {
    expect(isSectionReleaseVisible({ topicState: "open" }, NOW)).toBe(true);
    expect(isSectionReleaseVisible({ topicState: "closed" }, NOW)).toBe(false);
    expect(
      isSectionReleaseVisible(
        { opensAt: "2026-09-30T00:00:00.000Z", topicState: "scheduled" },
        NOW,
      ),
    ).toBe(true);
    expect(
      isSectionReleaseVisible(
        { opensAt: "2026-10-02T00:00:00.000Z", topicState: "scheduled" },
        NOW,
      ),
    ).toBe(false);
    expect(isSectionReleaseVisible({ topicState: "scheduled" }, NOW)).toBe(
      false,
    );
    expect(
      isSectionReleaseVisible(
        { opensAt: "not a date", topicState: "scheduled" },
        NOW,
      ),
    ).toBe(false);
  });

  it("orders visible releases by topic position, then question position", () => {
    const releases = [
      release("c", { position: 1, topicId: "t2", topicPosition: 1 }),
      release("hidden", { topicId: "t3", topicState: "closed" }),
      release("b", { position: 2, topicId: "t1", topicPosition: 0 }),
      release("a", { position: 0, topicId: "t2", topicPosition: 1 }),
      release("first", { position: 5, topicId: "t1", topicPosition: 0 }),
    ];

    expect(
      visibleSectionReleases(releases, NOW).map((item) => item.questionId),
    ).toEqual(["b", "first", "a", "c"]);
  });

  it("keeps only released, visible, still-published questions in section order", () => {
    const questions = [
      { id: "a", topicId: "t2" },
      { id: "b", topicId: "t1" },
      { id: "unreleased", topicId: "t1" },
      { id: "closed", topicId: "t3" },
    ];
    const releases = [
      release("a", { topicId: "t2", topicPosition: 1 }),
      release("b", { topicId: "t1", topicPosition: 0 }),
      release("closed", { topicId: "t3", topicState: "closed" }),
      release("unpublished-since", { topicId: "t1", topicPosition: 0 }),
    ];

    expect(
      selectSectionQuestions(questions, releases, NOW).map((item) => item.id),
    ).toEqual(["b", "a"]);
    expect(
      selectSectionTopics(
        [{ id: "t1" }, { id: "t2" }, { id: "t3" }, { id: "t4" }],
        releases,
        NOW,
      ).map((topic) => topic.id),
    ).toEqual(["t1", "t2"]);
    expect(findVisibleSectionRelease(releases, "closed", NOW)).toBeUndefined();
    expect(findVisibleSectionRelease(releases, "a", NOW)?.questionId).toBe("a");
    expect(Object.keys(sectionDeliveryByQuestionId(releases, NOW))).toEqual([
      "b",
      "unpublished-since",
      "a",
    ]);
  });

  it("swaps in each question's pinned content and drops unreadable pins", () => {
    const questions = [
      { id: "a", title: "published a" },
      { id: "b", title: "published b" },
    ];

    expect(withPinnedQuestions(questions, undefined)).toEqual(questions);
    expect(
      withPinnedQuestions(questions, { a: { id: "a", title: "pinned a" } }),
    ).toEqual([{ id: "a", title: "pinned a" }]);
  });

  it("reads join codes the way the field does", () => {
    expect(parseJoinCode("k7q2m")).toBe("K7Q-2M");
    expect(parseJoinCode(" R4N 8x ")).toBe("R4N-8X");
    expect(parseJoinCode("K7Q")).toBeUndefined();
    expect(parseJoinCode(12345)).toBeUndefined();
    expect(parseJoinCode("x".repeat(40))).toBeUndefined();
  });

  it("opens worked steps by the section's reveal rule", () => {
    const fresh = { solved: false, wrongAttemptCount: 0 };
    const twoWrong = { solved: false, wrongAttemptCount: 2 };
    const threeWrong = { solved: false, wrongAttemptCount: 3 };
    const solved = { solved: true, wrongAttemptCount: 0 };

    expect(solutionRevealAllowed("never", solved)).toBe(false);
    expect(solutionRevealAllowed("after_2_wrong", fresh)).toBe(false);
    expect(solutionRevealAllowed("after_2_wrong", twoWrong)).toBe(true);
    expect(solutionRevealAllowed("after_3_wrong", twoWrong)).toBe(false);
    expect(solutionRevealAllowed("after_3_wrong", threeWrong)).toBe(true);
    expect(solutionRevealAllowed("after_3_wrong", solved)).toBe(true);
    expect(solutionRevealAllowed("after_correct", threeWrong)).toBe(false);
    expect(solutionRevealAllowed("after_correct", solved)).toBe(true);
  });

  it("counts Check answers left and refuses what the section turned off", () => {
    const delivery: DeliverySettings = {
      attemptsAllowed: 2,
      hintsEnabled: false,
      solutionReveal: "after_correct",
    };

    expect(
      attemptsRemaining(delivery, { solved: false, wrongAttemptCount: 1 }),
    ).toBe(1);
    expect(
      attemptsRemaining(delivery, { solved: false, wrongAttemptCount: 5 }),
    ).toBe(0);

    expect(
      deliveryRefusal({
        delivery,
        mode: "hint",
        progress: { solved: false, wrongAttemptCount: 0 },
      }),
    ).toMatchObject({ code: "SECTION_HINTS_DISABLED", status: 400 });
    expect(
      deliveryRefusal({
        delivery,
        mode: "check",
        progress: { solved: false, wrongAttemptCount: 2 },
      }),
    ).toMatchObject({ code: "SECTION_NO_ATTEMPTS_LEFT", status: 409 });
    // AI help is never an attempt, so the limit does not stop it.
    expect(
      deliveryRefusal({
        aiHelp: true,
        delivery,
        mode: "check",
        progress: { solved: false, wrongAttemptCount: 2 },
      }),
    ).toBeUndefined();
    expect(
      deliveryRefusal({
        delivery,
        mode: "full_solution",
        progress: { solved: false, wrongAttemptCount: 2 },
      }),
    ).toMatchObject({ code: "SECTION_STEPS_UNAVAILABLE", status: 409 });
    expect(
      deliveryRefusal({
        delivery: { ...delivery, solutionReveal: "never" },
        mode: "solution",
        progress: { solved: true, wrongAttemptCount: 0 },
      }),
    ).toMatchObject({ code: "SECTION_STEPS_UNAVAILABLE", status: 400 });
    expect(
      deliveryRefusal({
        delivery,
        mode: "full_solution",
        progress: { solved: true, wrongAttemptCount: 0 },
      }),
    ).toBeUndefined();
    expect(
      deliveryRefusal({
        delivery: OPEN_DELIVERY,
        mode: "hint",
        progress: { solved: false, wrongAttemptCount: 0 },
      }),
    ).toBeUndefined();
  });
});

describe("section-scoped content on the server", () => {
  beforeEach(() => {
    resetTutorSessionsForTests();
    mockPrincipal(undefined);
    mockStudentOwner(TEST_ANONYMOUS_OWNER);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    setCoursesRepositoryForTests(undefined);
    resetAuthMocks();
    vi.restoreAllMocks();
  });

  it("lists only the section's open releases, in the section's order", async () => {
    useSectionReleases([
      release("dice-sum-eight", { position: 0, topicPosition: 1 }),
      release("demo-conditional-spinner-coin", {
        topicId: "conditional-probability",
        topicPosition: 1,
        position: 1,
      }),
      release("demo-counting-cafe-codes", {
        topicId: "axioms-probability-counting-methods",
        topicPosition: 0,
      }),
      release("demo-basic-probability-colored-tickets", {
        topicId: "introduction-probability-venn-diagrams",
        topicState: "closed",
      }),
    ]);

    const response = await listQuestionsRoute(
      new Request("http://localhost/api/questions"),
    );
    const payload = (await response.json()) as {
      questions: { id: string }[];
    };

    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(payload.questions.map((question) => question.id)).toEqual([
      "demo-counting-cafe-codes",
      "dice-sum-eight",
      "demo-conditional-spinner-coin",
    ]);
  });

  it("keeps the global list for a student in no section", async () => {
    useSectionReleases(undefined);

    const response = await listQuestionsRoute(
      new Request("http://localhost/api/questions"),
    );
    const payload = (await response.json()) as { count: number };

    expect(payload.count).toBeGreaterThan(3);
  });

  it("refuses a session on a question the section has not released", async () => {
    useSectionReleases([release("dice-sum-eight")]);

    const refused = await postSession(
      jsonRequest("http://localhost/api/tutor/session", {
        idempotencyKey: "section:unreleased",
        questionId: "demo-conditional-spinner-coin",
      }),
    );
    const allowed = await postSession(
      jsonRequest("http://localhost/api/tutor/session", {
        idempotencyKey: "section:released",
        questionId: "dice-sum-eight",
      }),
    );

    expect(refused.status).toBe(404);
    expect(await refused.json()).toMatchObject({
      code: "QUESTION_UNAVAILABLE",
    });
    expect(allowed.status).toBe(201);
  });

  it("starts a section session on the pinned version and refuses any other", async () => {
    useSectionReleases([release("dice-sum-eight", { questionVersionId: 7 })]);

    const pinned = await postSession(
      jsonRequest("http://localhost/api/tutor/session", {
        idempotencyKey: "section:pinned",
        questionId: "dice-sum-eight",
      }),
    );
    expect(pinned.status).toBe(201);
    expect(await pinned.json()).toMatchObject({
      session: { questionVersionId: 7 },
    });

    const confirmed = await postSession(
      jsonRequest("http://localhost/api/tutor/session", {
        idempotencyKey: "section:confirmed",
        questionId: "dice-sum-eight",
        questionVersionId: 7,
      }),
    );
    expect(confirmed.status).toBe(201);

    const other = await postSession(
      jsonRequest("http://localhost/api/tutor/session", {
        idempotencyKey: "section:other-version",
        questionId: "dice-sum-eight",
        questionVersionId: 8,
      }),
    );
    expect(other.status).toBe(404);
    expect(await other.json()).toMatchObject({
      code: "QUESTION_UNAVAILABLE",
    });
  });

  it("refuses a client-named version for a student in no section", async () => {
    useSectionReleases(undefined);

    const named = await postSession(
      jsonRequest("http://localhost/api/tutor/session", {
        idempotencyKey: "global:named-version",
        questionId: "dice-sum-eight",
        questionVersionId: 1,
      }),
    );
    expect(named.status).toBe(404);
  });
});

describe("section delivery on the tutor route", () => {
  beforeEach(() => {
    resetTutorSessionsForTests();
    mockPrincipal(undefined);
    mockStudentOwner(TEST_ANONYMOUS_OWNER);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    setCoursesRepositoryForTests(undefined);
    resetAuthMocks();
    vi.restoreAllMocks();
  });

  async function startSession(key: string) {
    const response = await postSession(
      jsonRequest("http://localhost/api/tutor/session", {
        idempotencyKey: key,
        questionId: "dice-sum-eight",
      }),
    );
    const payload = (await response.json()) as { session: { id: string } };
    return payload.session.id;
  }

  function respond(sessionId: string, eventId: string, body: object) {
    return postTutorResponse(
      jsonRequest("http://localhost/api/tutor/respond", {
        answer: "",
        eventId,
        sessionId,
        ...body,
      }),
    );
  }

  it("refuses hints when the section turned them off, and never shows them", async () => {
    useSectionReleases([
      release("dice-sum-eight", {
        delivery: { ...OPEN_DELIVERY, hintsEnabled: false },
      }),
    ]);
    const sessionId = await startSession("delivery:hints");

    const hint = await respond(sessionId, "delivery:hints:1", {
      mode: "hint",
    });
    expect(hint.status).toBe(400);
    expect(await hint.json()).toEqual({
      code: "SECTION_HINTS_DISABLED",
      error: "Hints are turned off for this question in your section.",
    });

    const wrong = await respond(sessionId, "delivery:hints:2", {
      answer: "1/2",
      mode: "check",
    });
    const wrongPayload = (await wrong.json()) as {
      hints: string[];
      verdict: string;
    };
    expect(wrong.status).toBe(200);
    expect(wrongPayload.verdict).toBe("incorrect");
    expect(wrongPayload.hints).toEqual([]);

    // Recovery: the session read withholds hint text as well.
    const recovered = await getSessionRoute(
      new Request(`http://localhost/api/tutor/session/${sessionId}`),
      { params: Promise.resolve({ sessionId }) },
    );
    const recoveredPayload = (await recovered.json()) as {
      session: { disclosedHints: string[]; revealedHints: number };
    };
    expect(recovered.status).toBe(200);
    expect(recoveredPayload.session.revealedHints).toBeGreaterThan(0);
    expect(recoveredPayload.session.disclosedHints).toEqual([]);
  });

  it("returns revealed hint text on the session read when hints are on", async () => {
    useSectionReleases([release("dice-sum-eight")]);
    const sessionId = await startSession("delivery:hints-on");
    await respond(sessionId, "delivery:hints-on:1", {
      answer: "1/2",
      mode: "check",
    });

    const recovered = await getSessionRoute(
      new Request(`http://localhost/api/tutor/session/${sessionId}`),
      { params: Promise.resolve({ sessionId }) },
    );
    const recoveredPayload = (await recovered.json()) as {
      session: { disclosedHints: string[] };
    };
    expect(recoveredPayload.session.disclosedHints.length).toBeGreaterThan(0);
  });

  it("stops Check answer once the section's attempts are used up", async () => {
    useSectionReleases([
      release("dice-sum-eight", {
        delivery: { ...OPEN_DELIVERY, attemptsAllowed: 1 },
      }),
    ]);
    const sessionId = await startSession("delivery:attempts");

    const unreadable = await respond(sessionId, "delivery:attempts:0", {
      answer: "two fifths-ish",
      mode: "check",
    });
    expect(unreadable.status).toBe(200);

    const first = await respond(sessionId, "delivery:attempts:1", {
      answer: "1/2",
      mode: "check",
    });
    expect(first.status).toBe(200);

    const second = await respond(sessionId, "delivery:attempts:2", {
      answer: "2/5",
      mode: "check",
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({
      code: "SECTION_NO_ATTEMPTS_LEFT",
    });

    // The refused request recorded nothing: replaying the first event
    // still recovers its saved verdict.
    const replay = await respond(sessionId, "delivery:attempts:1", {
      answer: "1/2",
      mode: "check",
    });
    expect(replay.status).toBe(200);
  });

  it("holds the worked steps back until the section's rule opens them", async () => {
    useSectionReleases([
      release("dice-sum-eight", {
        delivery: { ...OPEN_DELIVERY, solutionReveal: "after_2_wrong" },
      }),
    ]);
    const sessionId = await startSession("delivery:steps");

    const early = await respond(sessionId, "delivery:steps:0", {
      mode: "full_solution",
    });
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({
      code: "SECTION_STEPS_UNAVAILABLE",
    });

    for (const [index, answer] of ["1/2", "1/3"].entries()) {
      const wrong = await respond(sessionId, `delivery:steps:wrong:${index}`, {
        answer,
        mode: "check",
      });
      expect(wrong.status).toBe(200);
    }

    const opened = await respond(sessionId, "delivery:steps:1", {
      mode: "full_solution",
    });
    const payload = (await opened.json()) as { steps: string[] };
    expect(opened.status).toBe(200);
    expect(payload.steps.length).toBeGreaterThan(0);
  });

  it("never opens the steps under a never rule", async () => {
    useSectionReleases([
      release("dice-sum-eight", {
        delivery: { ...OPEN_DELIVERY, solutionReveal: "never" },
      }),
    ]);
    const sessionId = await startSession("delivery:never");

    const refused = await respond(sessionId, "delivery:never:0", {
      mode: "solution",
    });
    expect(refused.status).toBe(400);
  });

  it("leaves students outside a section unrestricted", async () => {
    useSectionReleases(undefined);
    const sessionId = await startSession("delivery:none");

    const hint = await respond(sessionId, "delivery:none:0", { mode: "hint" });
    const steps = await respond(sessionId, "delivery:none:1", {
      mode: "full_solution",
    });

    expect(hint.status).toBe(200);
    expect(steps.status).toBe(200);
  });
});

describe("section delivery in the practice UI", () => {
  async function renderWorkspace(
    deliveryByQuestionId?: Record<string, DeliverySettings>,
  ) {
    const question = await getApprovedQuestionById("dice-sum-eight");
    const topics = (await getTopics()).filter(
      (topic) => topic.id === question?.topicId,
    );
    return renderToStaticMarkup(
      createElement(PracticeWorkspace, {
        deliveryByQuestionId,
        initialQuestionId: "dice-sum-eight",
        questions: [normalizeSummary(question!)],
        topics,
      }),
    );
  }

  it("hides the hint control and counts Check answers left", async () => {
    const markup = await renderWorkspace({
      "dice-sum-eight": {
        attemptsAllowed: 3,
        hintsEnabled: false,
        solutionReveal: "never",
      },
    });

    expect(markup).toContain("Check answer (3 left)");
    expect(markup).not.toContain("Show hint");
    expect(markup).not.toContain("Hint 1 of 3");
    expect(markup).not.toContain("Steps unlock after hint");
    expect(markup).not.toContain("Show steps");
  });

  it("is unchanged outside a section", async () => {
    const markup = await renderWorkspace();

    expect(markup).toContain("Check answer");
    expect(markup).not.toContain("left)");
    expect(markup).toContain("Show hint 1 of 3");
  });
});
