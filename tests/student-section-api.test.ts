import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DELETE as leaveSectionRoute,
  GET as getSectionRoute,
  POST as joinSectionRoute,
} from "@/app/api/student/section/route";
import type { StudentOwner } from "@/lib/auth/principal";
import {
  CoursesNotFoundError,
  type CoursesRepository,
  type StudentSectionDto,
} from "@/lib/data/courses-repository";
import { setCoursesRepositoryForTests } from "@/lib/data/data-store";
import {
  mockPrincipal,
  mockStudentOwner,
  resetAuthMocks,
  TEST_ANONYMOUS_OWNER,
  TEST_STUDENT,
} from "./auth-test-helpers";

const SECTION: StudentSectionDto = {
  courseCode: "MATH-255",
  courseId: "course-math-255",
  courseTitle: "Probability and Statistics",
  joinedAt: "2026-09-02T14:00:00.000Z",
  sectionId: "section-1",
  sectionLabel: "Section 1",
  term: "Fall 2026",
};

function fakeRepository(overrides: Partial<CoursesRepository> = {}) {
  const repository = {
    applyProfessorAction: vi.fn(async () => {
      throw new Error("not used");
    }),
    getSectionReleases: vi.fn(async () => []),
    getStudentSection: vi.fn(
      async (): Promise<StudentSectionDto | undefined> => undefined,
    ),
    joinSection: vi.fn(async () => SECTION),
    leaveSection: vi.fn(async () => undefined),
    loadProfessorState: vi.fn(async () => {
      throw new Error("not used");
    }),
    ...overrides,
  };
  setCoursesRepositoryForTests(repository as CoursesRepository);
  return repository;
}

function joinRequest(body: unknown, raw = false) {
  return new Request("http://localhost/api/student/section", {
    body: raw ? (body as string) : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

const STUDENT_OWNER: StudentOwner = {
  kind: "user",
  userId: TEST_STUDENT.userId,
};

beforeEach(() => {
  mockPrincipal(TEST_STUDENT);
});

afterEach(() => {
  setCoursesRepositoryForTests(undefined);
  resetAuthMocks();
  vi.restoreAllMocks();
});

describe("GET /api/student/section", () => {
  it("returns the student's own section, privately", async () => {
    const repository = fakeRepository({
      getStudentSection: vi.fn(async () => SECTION),
    });

    const response = await getSectionRoute(
      new Request("http://localhost/api/student/section"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ section: SECTION });
    expect(repository.getStudentSection).toHaveBeenCalledWith(STUDENT_OWNER);
  });

  it("answers null for a student in no section", async () => {
    fakeRepository();

    const response = await getSectionRoute(
      new Request("http://localhost/api/student/section"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ section: null });
  });

  it("reads an anonymous pilot browser's membership by its own identity", async () => {
    mockPrincipal(undefined);
    mockStudentOwner(TEST_ANONYMOUS_OWNER);
    const repository = fakeRepository();

    await getSectionRoute(new Request("http://localhost/api/student/section"));

    expect(repository.getStudentSection).toHaveBeenCalledWith(
      TEST_ANONYMOUS_OWNER,
    );
  });

  it("is 401 for a visitor with no identity at all", async () => {
    mockPrincipal(undefined);
    mockStudentOwner(undefined);
    const repository = fakeRepository();

    const response = await getSectionRoute(
      new Request("http://localhost/api/student/section"),
    );

    expect(response.status).toBe(401);
    expect(repository.getStudentSection).not.toHaveBeenCalled();
  });

  it("is a sanitized 503 when the sections store cannot be read", async () => {
    fakeRepository({
      getStudentSection: vi.fn(async () => {
        throw new Error("connection refused at db.internal:5432");
      }),
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await getSectionRoute(
      new Request("http://localhost/api/student/section"),
    );

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("db.internal");
  });
});

describe("POST /api/student/section", () => {
  it("joins by code in any case or spacing, normalised to the printed shape", async () => {
    const repository = fakeRepository();

    const response = await joinSectionRoute(joinRequest({ code: " k7q 2m " }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ section: SECTION });
    expect(repository.joinSection).toHaveBeenCalledWith(
      STUDENT_OWNER,
      "K7Q-2M",
    );
  });

  it("lets an anonymous pilot student join with their browser identity", async () => {
    mockPrincipal(undefined);
    mockStudentOwner(TEST_ANONYMOUS_OWNER);
    const repository = fakeRepository();

    const response = await joinSectionRoute(joinRequest({ code: "R4N-8X" }));

    expect(response.status).toBe(200);
    expect(repository.joinSection).toHaveBeenCalledWith(
      TEST_ANONYMOUS_OWNER,
      "R4N-8X",
    );
  });

  it("is 404 with a plain sentence for a well-formed code that names no section", async () => {
    fakeRepository({
      joinSection: vi.fn(async () => {
        throw new CoursesNotFoundError("join code not found");
      }),
    });

    const response = await joinSectionRoute(joinRequest({ code: "ABC-DE" }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: "SECTION_CODE_UNKNOWN",
      error: "We don't recognise that code. Check it with your professor.",
    });
  });

  it.each([
    ["a short code", { code: "K7Q" }],
    ["a long code", { code: "K7Q-2MX" }],
    ["a number", { code: 12345 }],
    ["no code", {}],
    ["an array", ["K7Q-2M"]],
    ["an oversized paste", { code: `K7Q-2M${" ".repeat(64)}` }],
  ])("is 400 for %s and never reaches the store", async (_label, body) => {
    const repository = fakeRepository();

    const response = await joinSectionRoute(joinRequest(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "MALFORMED_SECTION_CODE",
      error: "Enter the code from your professor, like K7Q-2M.",
    });
    expect(repository.joinSection).not.toHaveBeenCalled();
  });

  it("is 400 for a body that is not JSON", async () => {
    const repository = fakeRepository();

    const response = await joinSectionRoute(joinRequest("{code:", true));

    expect(response.status).toBe(400);
    expect(repository.joinSection).not.toHaveBeenCalled();
  });

  it("is 401 for a visitor with no identity and no anonymous pilot", async () => {
    mockPrincipal(undefined);
    mockStudentOwner(undefined);
    const repository = fakeRepository();

    const response = await joinSectionRoute(joinRequest({ code: "K7Q-2M" }));

    expect(response.status).toBe(401);
    expect(repository.joinSection).not.toHaveBeenCalled();
  });

  it("is a sanitized 503 when the join cannot be written", async () => {
    fakeRepository({
      joinSection: vi.fn(async () => {
        throw new Error("deadlock detected on section_members");
      }),
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await joinSectionRoute(joinRequest({ code: "K7Q-2M" }));

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain(
      "section_members",
    );
  });
});

describe("DELETE /api/student/section", () => {
  it("leaves the student's sections and answers null", async () => {
    const repository = fakeRepository();

    const response = await leaveSectionRoute(
      new Request("http://localhost/api/student/section", {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ section: null });
    expect(repository.leaveSection).toHaveBeenCalledWith(STUDENT_OWNER);
  });

  it("is 401 without an identity", async () => {
    mockPrincipal(undefined);
    mockStudentOwner(undefined);
    const repository = fakeRepository();

    const response = await leaveSectionRoute(
      new Request("http://localhost/api/student/section", {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(401);
    expect(repository.leaveSection).not.toHaveBeenCalled();
  });
});
