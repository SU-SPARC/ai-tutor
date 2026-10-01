import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as applyCourseAction } from "@/app/api/professor/courses/actions/route";
import { GET as getCourses } from "@/app/api/professor/courses/route";
import { createSeedState } from "@/lib/courses/demo-seed";
import {
  CoursesConflictError,
  CoursesNotFoundError,
  CoursesValidationError,
} from "@/lib/data/courses-repository";
import {
  applyProfessorCoursesAction,
  coursesDemoMode,
  getProfessorCoursesState,
} from "@/lib/data/data-store";
import { DataServiceUnavailableError } from "@/lib/data/service-error";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
  TEST_STUDENT,
} from "./auth-test-helpers";

vi.mock("@/lib/data/data-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data/data-store")>();
  return {
    ...actual,
    applyProfessorCoursesAction: vi.fn(),
    coursesDemoMode: vi.fn(),
    getProfessorCoursesState: vi.fn(),
  };
});

const STATE = { ...createSeedState(), activeCourseId: null };

function actionRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://test/api/professor/courses/actions", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
    method: "POST",
  });
}

function lastAction() {
  const calls = vi.mocked(applyProfessorCoursesAction).mock.calls;
  return calls[calls.length - 1]?.[1];
}

beforeEach(() => {
  mockPrincipal(TEST_PROFESSOR);
  vi.mocked(getProfessorCoursesState).mockResolvedValue(STATE);
  vi.mocked(applyProfessorCoursesAction).mockResolvedValue(STATE);
  vi.mocked(coursesDemoMode).mockReturnValue(false);
});

afterEach(() => {
  resetAuthMocks();
  vi.mocked(getProfessorCoursesState).mockReset();
  vi.mocked(applyProfessorCoursesAction).mockReset();
  vi.mocked(coursesDemoMode).mockReset();
});

describe("professor courses API authorization", () => {
  it("rejects anonymous callers and students on both routes", async () => {
    mockPrincipal(undefined);
    expect(
      (await getCourses(new Request("http://test/api/professor/courses")))
        .status,
    ).toBe(401);
    expect(
      (
        await applyCourseAction(
          actionRequest({ action: { type: "course/archive", courseId: "c" } }),
        )
      ).status,
    ).toBe(401);

    mockPrincipal(TEST_STUDENT);
    expect(
      (await getCourses(new Request("http://test/api/professor/courses")))
        .status,
    ).toBe(403);
    expect(
      (
        await applyCourseAction(
          actionRequest({ action: { type: "course/archive", courseId: "c" } }),
        )
      ).status,
    ).toBe(403);

    expect(getProfessorCoursesState).not.toHaveBeenCalled();
    expect(applyProfessorCoursesAction).not.toHaveBeenCalled();
  });
});

describe("GET /api/professor/courses", () => {
  it("returns the professor's state and the demo flag as private JSON", async () => {
    vi.mocked(coursesDemoMode).mockReturnValue(true);
    const response = await getCourses(
      new Request("http://test/api/professor/courses"),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(payload).toEqual({ demo: true, state: STATE });
    expect(getProfessorCoursesState).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: expect.objectContaining({ userId: TEST_PROFESSOR.userId }),
      }),
    );
  });

  it("returns 503 when the data service is unavailable", async () => {
    vi.mocked(getProfessorCoursesState).mockRejectedValue(
      new DataServiceUnavailableError("content"),
    );
    const response = await getCourses(
      new Request("http://test/api/professor/courses"),
    );

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("courses-repository");
  });

  it("keeps students as hashed keys only in what it returns", async () => {
    const response = await getCourses(
      new Request("http://test/api/professor/courses"),
    );
    const payload = (await response.json()) as typeof STATE & {
      state: typeof STATE;
    };

    for (const member of payload.state.members) {
      expect(Object.keys(member)).not.toEqual(
        expect.arrayContaining(["email", "displayName", "userId", "ownerId"]),
      );
    }
  });
});

describe("POST /api/professor/courses/actions", () => {
  it("applies a whitelisted action, stamps server time, and returns the state", async () => {
    const before = Date.now();
    const response = await applyCourseAction(
      actionRequest(
        {
          action: {
            type: "section/applyReleaseChanges",
            sectionId: "  math-255-fall-2026-sec-01 ",
            changes: [
              { kind: "add", questionId: "q-1", extra: "dropped" },
              { kind: "remove", questionId: "q-2" },
            ],
            now: "1999-01-01T00:00:00.000Z",
            state: { courses: [] },
          },
        },
        { "Idempotency-Key": "idem-1", "X-Request-Id": "req-1" },
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ state: STATE });
    const [authorization, action, requestId] = vi.mocked(
      applyProfessorCoursesAction,
    ).mock.calls[0];
    expect(authorization.principal).toMatchObject({
      userId: TEST_PROFESSOR.userId,
    });
    expect(requestId).toBe("idem-1");
    expect(action).toMatchObject({
      type: "section/applyReleaseChanges",
      sectionId: "math-255-fall-2026-sec-01",
      changes: [
        { kind: "add", questionId: "q-1" },
        { kind: "remove", questionId: "q-2" },
      ],
    });
    expect(Object.keys(action)).toEqual([
      "type",
      "sectionId",
      "changes",
      "now",
    ]);
    expect((action as { changes: object[] }).changes[0]).not.toHaveProperty(
      "extra",
    );
    const now = Date.parse((action as { now: string }).now);
    expect(now).toBeGreaterThanOrEqual(before);
  });

  it("falls back to X-Request-Id for the request id", async () => {
    await applyCourseAction(
      actionRequest(
        { action: { type: "course/archive", courseId: "math-255" } },
        { "X-Request-Id": "req-2" },
      ),
    );
    expect(vi.mocked(applyProfessorCoursesAction).mock.calls[0][2]).toBe(
      "req-2",
    );
  });

  it("rebuilds nested patches field by field", async () => {
    await applyCourseAction(
      actionRequest({
        action: {
          type: "section/updateDelivery",
          sectionId: "sec-1",
          questionId: "q-1",
          patch: { attemptsAllowed: 5, hintsEnabled: false, injected: true },
        },
      }),
    );
    expect(lastAction()).toEqual({
      type: "section/updateDelivery",
      sectionId: "sec-1",
      questionId: "q-1",
      patch: { attemptsAllowed: 5, hintsEnabled: false },
    });

    await applyCourseAction(
      actionRequest({
        action: {
          type: "course/create",
          course: {
            id: "math-101-spring-2027",
            code: " MATH-101 ",
            title: "Intro",
            term: "Spring 2027",
            status: "active",
            ownerUserId: "user:someone-else",
          },
        },
      }),
    );
    expect(lastAction()).toMatchObject({
      type: "course/create",
      course: {
        id: "math-101-spring-2027",
        code: "MATH-101",
        title: "Intro",
        term: "Spring 2027",
        status: "active",
      },
    });
    expect((lastAction() as { course: object }).course).not.toHaveProperty(
      "ownerUserId",
    );

    await applyCourseAction(
      actionRequest({
        action: {
          type: "section/setTopicState",
          sectionId: "sec-1",
          topicId: "bayes",
          state: "open",
          opensAt: "2026-10-01T00:00:00.000Z",
        },
      }),
    );
    expect(lastAction()).toMatchObject({ state: "open", opensAt: null });
  });

  it.each([
    ["malformed JSON", "{not json"],
    ["no action", { type: "course/archive" }],
    ["an unknown type", { action: { type: "course/delete", courseId: "c" } }],
    [
      "hydrate with a whole client state",
      { action: { type: "hydrate", state: { courses: [] } } },
    ],
    ["a missing id", { action: { type: "course/archive" } }],
    [
      "an id that is not a slug",
      { action: { type: "course/archive", courseId: "../etc/passwd" } },
    ],
    [
      "an over-long title",
      {
        action: {
          type: "course/create",
          course: {
            id: "c-1",
            code: "MATH-1",
            title: "x".repeat(121),
            term: "Fall",
          },
        },
      },
    ],
    [
      "attempts out of range",
      {
        action: {
          type: "section/updateDelivery",
          sectionId: "s",
          questionId: "q",
          patch: { attemptsAllowed: 11 },
        },
      },
    ],
    [
      "an empty patch",
      {
        action: {
          type: "section/update",
          sectionId: "s",
          patch: { joinCode: "AAA-BB" },
        },
      },
    ],
    [
      "scheduled without a date",
      {
        action: {
          type: "section/setTopicState",
          sectionId: "s",
          topicId: "t",
          state: "scheduled",
        },
      },
    ],
    [
      "a bad direction",
      {
        action: {
          type: "course/moveTopic",
          courseId: "c",
          topicId: "t",
          direction: "sideways",
        },
      },
    ],
  ] as const)("returns 400 for %s", async (_name, body) => {
    const response = await applyCourseAction(actionRequest(body));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toEqual(expect.any(String));
    expect(applyProfessorCoursesAction).not.toHaveBeenCalled();
  });

  it.each([
    [new CoursesValidationError("Reset is only for the demo."), 400],
    [new CoursesNotFoundError("Course not found."), 404],
    [new CoursesConflictError("Someone else changed this course."), 409],
  ] as const)("maps %s to %i with its message", async (error, status) => {
    vi.mocked(applyProfessorCoursesAction).mockRejectedValue(error);
    const response = await applyCourseAction(
      actionRequest({ action: { type: "reset" } }),
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: error.message });
  });

  it("returns 503 for anything else", async () => {
    vi.mocked(applyProfessorCoursesAction).mockRejectedValue(
      new Error("connection refused at 10.0.0.1"),
    );
    const response = await applyCourseAction(
      actionRequest({ action: { type: "course/archive", courseId: "c" } }),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("10.0.0.1");
  });
});

describe("professor courses API against the demo store", () => {
  it("loads, applies an action, and refuses client-only actions", async () => {
    const actual = await vi.importActual<
      typeof import("@/lib/data/data-store")
    >("@/lib/data/data-store");
    vi.stubEnv("APP_DEMO_MODE", "true");
    vi.stubEnv("DATABASE_URL", "");
    vi.mocked(getProfessorCoursesState).mockImplementation(
      actual.getProfessorCoursesState,
    );
    vi.mocked(applyProfessorCoursesAction).mockImplementation(
      actual.applyProfessorCoursesAction,
    );
    vi.mocked(coursesDemoMode).mockImplementation(actual.coursesDemoMode);
    try {
      const loaded = await getCourses(
        new Request("http://test/api/professor/courses"),
      );
      const { state, demo } = (await loaded.json()) as {
        state: typeof STATE;
        demo: boolean;
      };
      expect(loaded.status).toBe(200);
      expect(demo).toBe(true);
      const section = state.sections.find(
        (candidate) => candidate.status === "active",
      );
      expect(section).toBeDefined();

      const renamed = await applyCourseAction(
        actionRequest({
          action: {
            type: "section/update",
            sectionId: section?.id,
            patch: { label: "Renamed by test" },
          },
        }),
      );
      const after = (await renamed.json()) as { state: typeof STATE };
      expect(renamed.status).toBe(200);
      expect(
        after.state.sections.find((candidate) => candidate.id === section?.id)
          ?.label,
      ).toBe("Renamed by test");

      const setActive = await applyCourseAction(
        actionRequest({
          action: { type: "course/setActive", courseId: section?.courseId },
        }),
      );
      expect(setActive.status).toBe(400);

      const reset = await applyCourseAction(
        actionRequest({ action: { type: "reset" } }),
      );
      expect(reset.status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
