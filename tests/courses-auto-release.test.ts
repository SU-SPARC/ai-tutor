import { describe, expect, it } from "vitest";

import {
  autoReleaseActions,
  onlyActiveSection,
  planAutoRelease,
} from "@/lib/courses/auto-release";
import { coursesReducer } from "@/lib/courses/reducer";
import {
  DEFAULT_DELIVERY_SETTINGS,
  type BankQuestion,
  type CanonicalTopic,
  type Course,
  type CourseSection,
  type CoursesState,
} from "@/lib/courses/types";

const NOW = "2026-10-20T12:00:00.000Z";

function topic(id: string, order: number): CanonicalTopic {
  return {
    id,
    title: id,
    description: "",
    order,
    weekNumber: order,
    active: true,
  };
}

function question(
  id: string,
  topicId: string,
  overrides: Partial<BankQuestion> = {},
): BankQuestion {
  return {
    id,
    topicId,
    title: id,
    prompt: `Prompt for ${id}`,
    answerType: "numeric",
    difficulty: "foundational",
    state: "published",
    publishedVersion: 2,
    latestVersion: 2,
    finalAnswer: "1",
    hints: [],
    solutionSteps: [],
    misconceptions: [],
    tags: [],
    updatedAt: NOW,
    ...overrides,
  };
}

function course(id: string, status: Course["status"] = "active"): Course {
  return {
    id,
    code: id.toUpperCase(),
    title: id,
    term: "Fall 2026",
    status,
    createdAt: NOW,
  };
}

function section(
  id: string,
  courseId: string,
  status: CourseSection["status"] = "active",
): CourseSection {
  return {
    id,
    courseId,
    label: id,
    meetingTime: "",
    joinCode: "ABC-DE",
    status,
    createdAt: NOW,
  };
}

/** One course with two included weeks, one section, both weeks closed. */
function state(overrides: Partial<CoursesState> = {}): CoursesState {
  return {
    schemaVersion: 1,
    activeCourseId: null,
    topics: [topic("t1", 1), topic("t2", 2)],
    bank: [
      question("q1", "t1"),
      question("q2", "t1"),
      question("q3", "t2"),
      question("draft", "t1", {
        state: "needs_review",
        publishedVersion: null,
      }),
    ],
    courses: [course("c1")],
    courseTopics: [
      {
        courseId: "c1",
        topicId: "t1",
        position: 0,
        displayLabel: null,
        included: true,
      },
      {
        courseId: "c1",
        topicId: "t2",
        position: 1,
        displayLabel: null,
        included: true,
      },
    ],
    sections: [section("s1", "c1")],
    members: [],
    topicAvailability: [
      { sectionId: "s1", topicId: "t1", state: "closed", opensAt: null },
      { sectionId: "s1", topicId: "t2", state: "closed", opensAt: null },
    ],
    questionAvailability: [],
    pinnedSessions: {},
    ...overrides,
  };
}

describe("planAutoRelease", () => {
  it("releases what was published to the only section and opens its closed weeks", () => {
    const plan = planAutoRelease(state(), ["q3", "q1"]);
    expect(plan).toEqual({
      courseId: "c1",
      sectionId: "s1",
      openTopics: ["t1", "t2"],
      questionIds: ["q3", "q1"],
    });

    // Carried out by the reducer, the plan lands exactly like the builder's
    // "Review N changes": pinned to the published version, default delivery,
    // appended at the end of its week, and the weeks open.
    const after = autoReleaseActions(plan!, NOW).reduce(
      coursesReducer,
      state(),
    );
    expect(after.questionAvailability).toEqual([
      {
        sectionId: "s1",
        questionId: "q3",
        state: "released",
        releasedAt: NOW,
        releasedVersion: 2,
        position: 0,
        delivery: DEFAULT_DELIVERY_SETTINGS,
      },
      {
        sectionId: "s1",
        questionId: "q1",
        state: "released",
        releasedAt: NOW,
        releasedVersion: 2,
        position: 0,
        delivery: DEFAULT_DELIVERY_SETTINGS,
      },
    ]);
    expect(after.topicAvailability).toEqual([
      { sectionId: "s1", topicId: "t1", state: "open", opensAt: null },
      { sectionId: "s1", topicId: "t2", state: "open", opensAt: null },
    ]);
  });

  it("appends to a week that already has releases and leaves open or scheduled weeks alone", () => {
    const before = state({
      topicAvailability: [
        { sectionId: "s1", topicId: "t1", state: "open", opensAt: null },
        {
          sectionId: "s1",
          topicId: "t2",
          state: "scheduled",
          opensAt: "2026-11-01T00:00:00.000Z",
        },
      ],
      questionAvailability: [
        {
          sectionId: "s1",
          questionId: "q1",
          state: "released",
          releasedAt: NOW,
          releasedVersion: 2,
          position: 0,
          delivery: DEFAULT_DELIVERY_SETTINGS,
        },
      ],
    });
    const plan = planAutoRelease(before, ["q2", "q3"]);
    expect(plan).toEqual({
      courseId: "c1",
      sectionId: "s1",
      openTopics: [],
      questionIds: ["q2", "q3"],
    });
    const after = autoReleaseActions(plan!, NOW).reduce(coursesReducer, before);
    expect(
      after.questionAvailability.map((row) => [row.questionId, row.position]),
    ).toEqual([
      ["q1", 0],
      ["q2", 1],
      ["q3", 0],
    ]);
    expect(after.topicAvailability).toEqual(before.topicAvailability);
  });

  it("opens a week the section has no availability row for yet", () => {
    const plan = planAutoRelease(state({ topicAvailability: [] }), ["q1"]);
    expect(plan?.openTopics).toEqual(["t1"]);
  });

  it("skips unpublished questions, excluded weeks, and questions already in the section", () => {
    const before = state({
      courseTopics: [
        {
          courseId: "c1",
          topicId: "t1",
          position: 0,
          displayLabel: null,
          included: true,
        },
        {
          courseId: "c1",
          topicId: "t2",
          position: 1,
          displayLabel: null,
          included: false,
        },
      ],
      questionAvailability: [
        {
          sectionId: "s1",
          questionId: "q1",
          state: "held",
          releasedAt: null,
          releasedVersion: null,
          position: 0,
          delivery: DEFAULT_DELIVERY_SETTINGS,
        },
      ],
    });
    // draft: not published; q3: week excluded from the course; q1: held by
    // the professor; unknown: not in the bank.
    expect(
      planAutoRelease(before, ["draft", "q3", "q1", "unknown"]),
    ).toBeUndefined();
    expect(planAutoRelease(before, ["draft", "q2", "q3"])).toEqual({
      courseId: "c1",
      sectionId: "s1",
      openTopics: ["t1"],
      questionIds: ["q2"],
    });
  });

  it("does nothing unless the professor has exactly one active section", () => {
    expect(onlyActiveSection(state({ sections: [] }))).toBeUndefined();
    expect(planAutoRelease(state({ sections: [] }), ["q1"])).toBeUndefined();

    const two = state({ sections: [section("s1", "c1"), section("s2", "c1")] });
    expect(onlyActiveSection(two)).toBeUndefined();
    expect(planAutoRelease(two, ["q1"])).toBeUndefined();

    // Archived sections and sections of archived courses do not count.
    const oneLeft = state({
      courses: [course("c1"), course("old", "archived")],
      sections: [
        section("s1", "c1"),
        section("s2", "c1", "archived"),
        section("s3", "old"),
      ],
    });
    expect(onlyActiveSection(oneLeft)?.id).toBe("s1");
    expect(planAutoRelease(oneLeft, ["q1"])?.sectionId).toBe("s1");
  });

  it("keeps publish order and ignores a repeated id", () => {
    expect(planAutoRelease(state(), ["q2", "q1", "q2"])?.questionIds).toEqual([
      "q2",
      "q1",
    ]);
    expect(planAutoRelease(state(), [])).toBeUndefined();
  });
});
