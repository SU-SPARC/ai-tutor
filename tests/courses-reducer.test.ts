import { describe, expect, it } from "vitest";

import {
  FALL_2026_COURSE_ID,
  FALL_2026_SECTION_01_ID,
  FALL_2026_SECTION_02_ID,
  SEED_NOW,
  createSeedState,
} from "@/lib/courses/demo-seed";
import { coursesReducer } from "@/lib/courses/reducer";
import {
  DEFAULT_DELIVERY_SETTINGS,
  type BankQuestion,
  type CoursesState,
} from "@/lib/courses/types";

const APPLY_NOW = "2026-09-20T12:00:00.000Z";

function bankMap(state: CoursesState) {
  return new Map(state.bank.map((question) => [question.id, question]));
}

function rowsFor(state: CoursesState, sectionId: string) {
  return state.questionAvailability.filter(
    (row) => row.sectionId === sectionId,
  );
}

function firstWithState(state: CoursesState, lifecycle: BankQuestion["state"]) {
  const question = state.bank.find(
    (candidate) => candidate.state === lifecycle,
  );
  if (!question) {
    throw new Error(`seed has no ${lifecycle} question`);
  }
  return question;
}

describe("courses demo seed", () => {
  const state = createSeedState();

  it("is deterministic for a given clock", () => {
    expect(createSeedState()).toEqual(createSeedState());
    expect(createSeedState(SEED_NOW)).toEqual(state);
  });

  it("carries the 11 active canonical topics in syllabus order", () => {
    expect(state.topics).toHaveLength(11);
    expect(state.topics.every((topic) => topic.active)).toBe(true);
    expect(state.topics.map((topic) => topic.order)).toEqual(
      [...state.topics].map((topic) => topic.order).sort((a, b) => a - b),
    );
  });

  it("gives every topic 8 to 14 bank questions with unique, url-safe ids", () => {
    for (const topic of state.topics) {
      const count = state.bank.filter(
        (question) => question.topicId === topic.id,
      ).length;
      expect(count, topic.id).toBeGreaterThanOrEqual(8);
      expect(count, topic.id).toBeLessThanOrEqual(14);
    }
    const ids = state.bank.map((question) => question.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9:._-]+$/);
    }
  });

  it("shows a lifecycle mix, including unpublished questions", () => {
    const counts = state.bank.reduce<Record<string, number>>(
      (acc, question) => {
        acc[question.state] = (acc[question.state] ?? 0) + 1;
        return acc;
      },
      {},
    );
    expect(counts.published).toBeGreaterThan(0);
    expect(counts.approved).toBeGreaterThanOrEqual(3);
    expect(counts.needs_review).toBeGreaterThanOrEqual(5);
    expect(counts.draft).toBeGreaterThan(0);
    expect(counts.unpublished).toBeGreaterThanOrEqual(2);
  });

  it("only releases questions that are published, or were before an unpublish", () => {
    const bank = bankMap(state);
    for (const row of state.questionAvailability) {
      const question = bank.get(row.questionId);
      expect(question, row.questionId).toBeDefined();
      if (row.state === "released") {
        expect(question?.state, row.questionId).toBe("published");
        expect(row.releasedVersion).not.toBeNull();
      } else {
        expect(["published", "unpublished"]).toContain(question?.state);
      }
    }
  });

  it("keeps join codes unique across every section", () => {
    const codes = state.sections.map((section) => section.joinCode);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{2}$/);
    }
  });

  it("scopes the professor tools to Fall 2026 and keeps two archived terms", () => {
    expect(state.activeCourseId).toBe(FALL_2026_COURSE_ID);
    expect(
      state.courses.filter((course) => course.status === "archived"),
    ).toHaveLength(2);
    expect(
      state.members.filter((m) => m.sectionId === FALL_2026_SECTION_01_ID),
    ).toHaveLength(34);
    expect(
      state.members.filter((m) => m.sectionId === FALL_2026_SECTION_02_ID),
    ).toHaveLength(27);
  });

  it("pins open student sessions only to released rows of the Fall sections", () => {
    const entries = Object.entries(state.pinnedSessions);
    expect(entries.length).toBeGreaterThanOrEqual(5);
    for (const [key, count] of entries) {
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(9);
      const [sectionId, questionId] = key.split(":");
      expect([FALL_2026_SECTION_01_ID, FALL_2026_SECTION_02_ID]).toContain(
        sectionId,
      );
      expect(
        state.questionAvailability.some(
          (row) =>
            row.sectionId === sectionId &&
            row.questionId === questionId &&
            row.state === "released",
        ),
      ).toBe(true);
    }
  });
});

describe("coursesReducer — release changes", () => {
  it("skips adds whose bank state is not published", () => {
    const state = createSeedState();
    const approved = firstWithState(state, "approved");
    const needsReview = firstWithState(state, "needs_review");
    const publishable = state.bank.find(
      (question) =>
        question.state === "published" &&
        !state.questionAvailability.some(
          (row) =>
            row.sectionId === FALL_2026_SECTION_01_ID &&
            row.questionId === question.id,
        ),
    );
    expect(publishable).toBeDefined();

    const next = coursesReducer(state, {
      type: "section/applyReleaseChanges",
      sectionId: FALL_2026_SECTION_01_ID,
      now: APPLY_NOW,
      changes: [
        { kind: "add", questionId: approved.id },
        { kind: "add", questionId: needsReview.id },
        { kind: "add", questionId: publishable!.id },
        { kind: "add", questionId: "no-such-question" },
      ],
    });

    const ids = rowsFor(next, FALL_2026_SECTION_01_ID).map(
      (row) => row.questionId,
    );
    expect(ids).toContain(publishable!.id);
    expect(ids).not.toContain(approved.id);
    expect(ids).not.toContain(needsReview.id);

    const added = rowsFor(next, FALL_2026_SECTION_01_ID).find(
      (row) => row.questionId === publishable!.id,
    );
    expect(added).toMatchObject({
      state: "released",
      releasedAt: APPLY_NOW,
      releasedVersion: publishable!.publishedVersion,
      delivery: DEFAULT_DELIVERY_SETTINGS,
    });
  });

  it("appends an add to the end of its topic", () => {
    const state = createSeedState();
    const candidate = state.bank.find(
      (question) =>
        question.state === "published" &&
        !state.questionAvailability.some(
          (row) =>
            row.sectionId === FALL_2026_SECTION_01_ID &&
            row.questionId === question.id,
        ) &&
        state.questionAvailability.some((row) => {
          if (row.sectionId !== FALL_2026_SECTION_01_ID) {
            return false;
          }
          const sibling = state.bank.find((q) => q.id === row.questionId);
          return sibling?.topicId === question.topicId;
        }),
    );
    expect(candidate).toBeDefined();

    const before = rowsFor(state, FALL_2026_SECTION_01_ID).filter((row) => {
      const sibling = state.bank.find((q) => q.id === row.questionId);
      return sibling?.topicId === candidate!.topicId;
    });
    const highest = Math.max(...before.map((row) => row.position));

    const next = coursesReducer(state, {
      type: "section/applyReleaseChanges",
      sectionId: FALL_2026_SECTION_01_ID,
      now: APPLY_NOW,
      changes: [{ kind: "add", questionId: candidate!.id }],
    });
    const added = rowsFor(next, FALL_2026_SECTION_01_ID).find(
      (row) => row.questionId === candidate!.id,
    );
    expect(added?.position).toBe(highest + 1);
  });

  it("removes the availability row and its pinned-session count", () => {
    const state = createSeedState();
    const [key] = Object.keys(state.pinnedSessions);
    const [sectionId, questionId] = key.split(":");

    const next = coursesReducer(state, {
      type: "section/applyReleaseChanges",
      sectionId,
      now: APPLY_NOW,
      changes: [{ kind: "remove", questionId }],
    });

    expect(
      next.questionAvailability.some(
        (row) => row.sectionId === sectionId && row.questionId === questionId,
      ),
    ).toBe(false);
    expect(next.pinnedSessions[key]).toBeUndefined();
    // Other sections are untouched: a release is section-scoped.
    expect(rowsFor(next, FALL_2026_SECTION_02_ID)).toEqual(
      rowsFor(state, FALL_2026_SECTION_02_ID),
    );
  });

  it("is a no-op for an unknown section or an empty change set", () => {
    const state = createSeedState();
    expect(
      coursesReducer(state, {
        type: "section/applyReleaseChanges",
        sectionId: "sec-nope",
        now: APPLY_NOW,
        changes: [{ kind: "add", questionId: state.bank[0].id }],
      }),
    ).toBe(state);
    expect(
      coursesReducer(state, {
        type: "section/applyReleaseChanges",
        sectionId: FALL_2026_SECTION_01_ID,
        now: APPLY_NOW,
        changes: [],
      }),
    ).toBe(state);
  });
});

describe("coursesReducer — course/clone", () => {
  const state = createSeedState();
  const cloned = coursesReducer(state, {
    type: "course/clone",
    sourceCourseId: FALL_2026_COURSE_ID,
    newCourse: {
      id: "math-255-spring-2027",
      code: "MATH-255",
      title: "Probability & Statistics",
      term: "Spring 2027",
    },
    now: APPLY_NOW,
  });

  it("copies the syllabus overlay and makes new sections with new codes", () => {
    expect(
      cloned.courseTopics.filter(
        (row) => row.courseId === "math-255-spring-2027",
      ),
    ).toHaveLength(11);
    const sections = cloned.sections.filter(
      (section) => section.courseId === "math-255-spring-2027",
    );
    expect(sections.map((section) => section.id)).toEqual([
      "math-255-spring-2027-sec-01",
      "math-255-spring-2027-sec-02",
    ]);
    expect(sections.every((section) => section.status === "active")).toBe(true);
    const codes = cloned.sections.map((section) => section.joinCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("starts with an empty roster and every topic closed", () => {
    expect(
      cloned.members.filter((member) =>
        member.sectionId.startsWith("math-255-spring-2027"),
      ),
    ).toHaveLength(0);
    const topicRows = cloned.topicAvailability.filter((row) =>
      row.sectionId.startsWith("math-255-spring-2027"),
    );
    expect(topicRows.length).toBeGreaterThan(0);
    expect(topicRows.every((row) => row.state === "closed")).toBe(true);
  });

  it("copies the released set as held so nothing reaches a student", () => {
    const rows = cloned.questionAvailability.filter((row) =>
      row.sectionId.startsWith("math-255-spring-2027"),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.state === "held")).toBe(true);
    expect(rows.every((row) => row.releasedAt === null)).toBe(true);
    expect(rows.every((row) => row.releasedVersion !== null)).toBe(true);
  });

  it("refuses a duplicate id or an unknown source", () => {
    expect(
      coursesReducer(cloned, {
        type: "course/clone",
        sourceCourseId: FALL_2026_COURSE_ID,
        newCourse: {
          id: "math-255-spring-2027",
          code: "MATH-255",
          title: "Probability & Statistics",
          term: "Spring 2027",
        },
      }),
    ).toBe(cloned);
    expect(
      coursesReducer(state, {
        type: "course/clone",
        sourceCourseId: "nope",
        newCourse: { id: "x", code: "c", title: "t", term: "T" },
      }),
    ).toBe(state);
  });
});

describe("coursesReducer — bank gates", () => {
  it("publishes only from approved or unpublished", () => {
    const state = createSeedState();
    const approved = firstWithState(state, "approved");
    const draft = firstWithState(state, "draft");
    const unpublished = firstWithState(state, "unpublished");

    const published = coursesReducer(state, {
      type: "bank/publish",
      questionId: approved.id,
      now: APPLY_NOW,
    });
    const next = bankMap(published).get(approved.id);
    expect(next?.state).toBe("published");
    expect(next?.publishedVersion).toBe(approved.latestVersion);
    expect(next?.updatedAt).toBe(APPLY_NOW);

    expect(
      coursesReducer(state, {
        type: "bank/publish",
        questionId: draft.id,
        now: APPLY_NOW,
      }),
    ).toBe(state);
    expect(
      bankMap(
        coursesReducer(state, {
          type: "bank/publish",
          questionId: unpublished.id,
          now: APPLY_NOW,
        }),
      ).get(unpublished.id)?.state,
    ).toBe("published");
  });

  it("files every new question into the review queue", () => {
    const state = createSeedState();
    const next = coursesReducer(state, {
      type: "bank/addDraft",
      now: APPLY_NOW,
      question: {
        id: "professor-written-bayes-tree",
        topicId: "conditional-probability",
        title: "Conditional from a tree diagram",
        prompt: "A tree diagram splits on a first test result…",
        answerType: "numeric",
        difficulty: "core",
        finalAnswer: "0.25",
        hints: ["Start at the root."],
        solutionSteps: ["Multiply along the branch."],
      },
    });
    const added = bankMap(next).get("professor-written-bayes-tree");
    expect(added).toMatchObject({
      state: "needs_review",
      publishedVersion: null,
      latestVersion: 1,
      misconceptions: [],
      tags: [],
      updatedAt: APPLY_NOW,
    });

    // Same id twice, or an unknown topic, changes nothing.
    expect(
      coursesReducer(next, {
        type: "bank/addDraft",
        now: APPLY_NOW,
        question: {
          ...added!,
          title: "Different title",
        },
      }),
    ).toBe(next);
  });
});

describe("coursesReducer — smaller writes", () => {
  const state = createSeedState();

  it("moves a released question within its topic only", () => {
    const first = state.questionAvailability.find(
      (row) => row.sectionId === FALL_2026_SECTION_01_ID && row.position === 1,
    );
    expect(first).toBeDefined();
    const moved = coursesReducer(state, {
      type: "section/moveReleased",
      sectionId: FALL_2026_SECTION_01_ID,
      questionId: first!.questionId,
      direction: "up",
    });
    const after = moved.questionAvailability.find(
      (row) =>
        row.sectionId === FALL_2026_SECTION_01_ID &&
        row.questionId === first!.questionId,
    );
    expect(after?.position).toBe(0);
  });

  it("moves a section to another version and marks it released", () => {
    const held = state.questionAvailability.find(
      (row) =>
        row.sectionId === FALL_2026_SECTION_01_ID && row.state === "held",
    );
    expect(held).toBeDefined();
    const next = coursesReducer(state, {
      type: "section/moveToVersion",
      sectionId: FALL_2026_SECTION_01_ID,
      questionId: held!.questionId,
      version: 9,
    });
    const row = next.questionAvailability.find(
      (candidate) =>
        candidate.sectionId === FALL_2026_SECTION_01_ID &&
        candidate.questionId === held!.questionId,
    );
    expect(row).toMatchObject({ releasedVersion: 9, state: "released" });
  });

  it("regenerates a join code without colliding", () => {
    const next = coursesReducer(state, {
      type: "section/regenerateJoinCode",
      sectionId: FALL_2026_SECTION_01_ID,
    });
    const codes = next.sections.map((section) => section.joinCode);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes[0]).not.toBe("K7Q-2M");
  });

  it("keeps the switcher on an active course when one is archived", () => {
    const next = coursesReducer(state, {
      type: "course/archive",
      courseId: FALL_2026_COURSE_ID,
    });
    expect(next.activeCourseId).not.toBe(FALL_2026_COURSE_ID);
    expect(
      next.courses.find((course) => course.id === next.activeCourseId)?.status,
    ).toBe("active");
  });

  it("resets back to the seed", () => {
    const dirty = coursesReducer(state, {
      type: "course/updateTopic",
      courseId: FALL_2026_COURSE_ID,
      topicId: state.topics[0].id,
      patch: { included: false },
    });
    expect(dirty).not.toEqual(state);
    expect(coursesReducer(dirty, { type: "reset" })).toEqual(createSeedState());
  });

  it("ignores unknown ids everywhere", () => {
    expect(
      coursesReducer(state, { type: "course/setActive", courseId: "nope" }),
    ).toBe(state);
    expect(
      coursesReducer(state, {
        type: "section/update",
        sectionId: "nope",
        patch: { label: "x" },
      }),
    ).toBe(state);
    expect(
      coursesReducer(state, {
        type: "section/updateDelivery",
        sectionId: "nope",
        questionId: "nope",
        patch: { attemptsAllowed: 1 },
      }),
    ).toBe(state);
    expect(
      coursesReducer(state, {
        type: "course/moveTopic",
        courseId: FALL_2026_COURSE_ID,
        topicId: state.topics[0].id,
        direction: "up",
      }),
    ).toBe(state);
  });
});
