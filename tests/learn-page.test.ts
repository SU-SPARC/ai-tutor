import { describe, expect, it } from "vitest";

import {
  buildLearnModel,
  buildPracticeCalendar,
  buildTopicModel,
  buildWeekStrip,
  isTopicIdShape,
  questionPositionLabel,
  relativeTimeLabel,
  solvedCountLabel,
  topicMasteryLevel,
  weekStartIsoFor,
} from "@/components/learn/learn-model";
import { toSyllabusRailTopics } from "@/components/learn/learn-syllabus-rail";
import type {
  CourseTopic,
  StudentPracticeQuestion,
  StudentProgressDashboard,
} from "@/lib/types";

// Thursday of the week that starts Monday 2026-09-07.
const NOW = "2026-09-10T12:00:00.000Z";

const topics: CourseTopic[] = [
  {
    active: true,
    description: "Sample spaces and Venn diagrams.",
    id: "introduction",
    moduleRef: "Week 1",
    order: 1,
    title: "Introduction to Probability",
    weekNumber: 1,
  },
  {
    active: true,
    description: "Restrict the sample space.",
    id: "conditional-probability",
    moduleRef: "Week 3",
    order: 3,
    title: "Conditional Probability",
    weekNumber: 3,
  },
  {
    active: true,
    description: "Approximate sample means.",
    id: "central-limit-theorem",
    moduleRef: "Week 13",
    order: 13,
    title: "Central Limit Theorem",
    weekNumber: 13,
  },
];

const questions: StudentPracticeQuestion[] = [
  question({ id: "venn-union", topicId: "introduction" }),
  question({
    difficulty: "intermediate",
    id: "dice-sum-eight",
    topicId: "conditional-probability",
  }),
  question({
    difficulty: "challenge",
    id: "spinner-coin",
    topicId: "conditional-probability",
  }),
];

function question(
  overrides: Partial<StudentPracticeQuestion> &
    Pick<StudentPracticeQuestion, "id" | "topicId">,
): StudentPracticeQuestion {
  return {
    difficulty: "foundational",
    difficultyLabel: "Foundational",
    hintCount: 3,
    inputFormatHint: "Enter a decimal.",
    prompt: `Prompt for ${overrides.id}`,
    sourceLabel: "Original",
    sourceType: "original_demo",
    stepCount: 1,
    title: `Title for ${overrides.id}`,
    ...overrides,
  };
}

function progressWith(
  overrides: Partial<StudentProgressDashboard> = {},
): StudentProgressDashboard {
  return {
    mode: "demo",
    questions: [],
    recentSessions: [],
    summary: {
      availableCompletedQuestions: 0,
      availableQuestions: 3,
      completedQuestions: 0,
      hintsUsed: 0,
      inProgressQuestions: 0,
      needsAnotherAttempt: 0,
      previouslyCompletedQuestions: 0,
      topicsStarted: 0,
    },
    topics: [],
    ...overrides,
  };
}

const solvedVenn: StudentProgressDashboard["questions"][number] = {
  attemptCount: 1,
  available: true,
  completedAt: "2026-09-08T09:00:00.000Z",
  hintsUsed: 0,
  lastActiveAt: "2026-09-08T09:00:00.000Z",
  needsAnotherAttempt: false,
  questionId: "venn-union",
  questionTitle: "Title for venn-union",
  status: "completed",
  topicId: "introduction",
  topicTitle: "Introduction to Probability",
};

const openDice: StudentProgressDashboard["questions"][number] = {
  attemptCount: 2,
  available: true,
  hintsUsed: 1,
  lastActiveAt: "2026-09-10T10:00:00.000Z",
  needsAnotherAttempt: true,
  questionId: "dice-sum-eight",
  questionTitle: "Title for dice-sum-eight",
  resumeSessionId: "session:dice",
  status: "in_progress",
  topicId: "conditional-probability",
  topicTitle: "Conditional Probability",
};

const openDiceSession: StudentProgressDashboard["recentSessions"][number] = {
  attemptCount: 2,
  available: true,
  hintsUsed: 1,
  lastSeenAt: "2026-09-10T10:00:00.000Z",
  needsAnotherAttempt: true,
  questionId: "dice-sum-eight",
  questionTitle: "Title for dice-sum-eight",
  sessionId: "session:dice",
  status: "in_progress",
  stepsRevealed: 0,
  topicId: "conditional-probability",
  topicTitle: "Conditional Probability",
};

describe("the week strip", () => {
  it("starts on Monday and fills only the days with practice", () => {
    expect(weekStartIsoFor(NOW)).toBe("2026-09-07");

    const week = buildWeekStrip({
      nowIso: NOW,
      progress: progressWith({
        questions: [solvedVenn, openDice],
        recentSessions: [openDiceSession],
      }),
    });

    expect(week.days.map((day) => day.label)).toEqual([
      "M",
      "T",
      "W",
      "T",
      "F",
      "S",
      "S",
    ]);
    expect(week.days.map((day) => day.active)).toEqual([
      false,
      true,
      false,
      true,
      false,
      false,
      false,
    ]);
    expect(week.days.filter((day) => day.isToday)).toHaveLength(1);
  });

  it("counts problems and first-try answers, and never invents a percentage", () => {
    const week = buildWeekStrip({
      nowIso: NOW,
      progress: progressWith({ questions: [solvedVenn, openDice] }),
    });

    expect(week.completedThisWeek).toBe(1);
    expect(week.summary).toBe("1 problem · 100% first-try");

    const empty = buildWeekStrip({ nowIso: NOW, progress: progressWith() });
    expect(empty.summary).toBe("0 problems · — first-try");

    const guest = buildWeekStrip({ nowIso: NOW, progress: null });
    expect(guest.days.every((day) => !day.active)).toBe(true);
    expect(guest.summary).toBe("0 problems · — first-try");
  });

  it("leaves out work completed in an earlier week", () => {
    const week = buildWeekStrip({
      nowIso: NOW,
      progress: progressWith({
        questions: [
          {
            ...solvedVenn,
            completedAt: "2026-09-06T09:00:00.000Z",
            lastActiveAt: "2026-09-06T09:00:00.000Z",
          },
        ],
      }),
    });

    expect(week.completedThisWeek).toBe(0);
  });

  it("says nothing about streaks", () => {
    const week = buildWeekStrip({
      nowIso: NOW,
      progress: progressWith({ questions: [solvedVenn] }),
    });

    expect(week.summary).not.toMatch(/streak|fire|badge|rank|xp/i);
  });
});

describe("derived question and topic state", () => {
  it("marks each question done, in progress, untouched, or retired", () => {
    const model = buildLearnModel({
      nowIso: NOW,
      progress: progressWith({
        questions: [solvedVenn, openDice],
        recentSessions: [
          openDiceSession,
          {
            ...openDiceSession,
            available: false,
            questionId: "spinner-coin",
            sessionId: "session:retired",
            status: "unavailable",
          },
        ],
      }),
      questions,
      topics,
    });

    expect(
      Object.fromEntries(model.questions.map((row) => [row.id, row.status])),
    ).toEqual({
      "venn-union": "done",
      "dice-sum-eight": "current",
      "spinner-coin": "retired",
    });
    expect(model.questions.map((row) => row.position)).toEqual([1, 1, 2]);
  });

  it("gives each topic its counts, its glyph, and one you-are-here marker", () => {
    const model = buildLearnModel({
      nowIso: NOW,
      progress: progressWith({
        questions: [solvedVenn, openDice],
        recentSessions: [openDiceSession],
      }),
      questions,
      topics,
    });

    expect(
      model.topics.map((topic) => [
        topic.id,
        `${topic.solved}/${topic.total}`,
        topic.glyph,
      ]),
    ).toEqual([
      ["introduction", "1/1", "done"],
      ["conditional-probability", "0/2", "current"],
      ["central-limit-theorem", "0/0", "closed"],
    ]);
    expect(
      model.topics.find((topic) => topic.id === "central-limit-theorem")?.meta,
    ).toBe("no questions yet");
    expect(model.topics.filter((topic) => topic.isCurrent)).toHaveLength(1);
    expect(model.topics.find((topic) => topic.isCurrent)?.id).toBe(
      "conditional-probability",
    );
  });

  it("keeps an empty topic in the list rather than skipping its week", () => {
    const model = buildLearnModel({
      nowIso: NOW,
      progress: null,
      questions,
      topics,
    });

    expect(model.topics.map((topic) => topic.index)).toEqual([1, 2, 3]);
    expect(model.isGuest).toBe(true);
  });
});

describe("what to continue", () => {
  it("resumes the live session and offers the first untouched question beside it", () => {
    const model = buildLearnModel({
      nowIso: NOW,
      progress: progressWith({
        questions: [solvedVenn, openDice],
        recentSessions: [openDiceSession],
      }),
      questions,
      topics,
    });

    expect(model.continueCard).toMatchObject({
      eyebrow: "Wk 3 · Conditional Probability",
      kind: "resume",
      primary: {
        href: "/practice/dice-sum-eight?sessionId=session%3Adice",
        label: "Resume →",
      },
      questionTitle: "Title for dice-sum-eight",
      secondary: { href: "/practice/spinner-coin", label: "Next new" },
    });
    expect(model.continueCard.detail).toContain("1 hint used");
    expect(model.continueCard.detail).toContain("last opened 2h ago");
  });

  it("says start here when nothing is in progress", () => {
    const model = buildLearnModel({
      nowIso: NOW,
      progress: progressWith({ questions: [solvedVenn] }),
      questions,
      topics,
    });

    expect(model.continueCard).toMatchObject({
      kind: "start",
      message: "Start here",
      primary: { href: "/practice/dice-sum-eight" },
    });
    expect(model.continueCard.secondary).toBeUndefined();
  });

  it("says so plainly when there is nothing published at all", () => {
    const model = buildLearnModel({
      nowIso: NOW,
      progress: null,
      questions: [],
      topics,
    });

    expect(model.continueCard.kind).toBe("empty");
    expect(model.continueCard.message).toContain(
      "No practice questions are available yet",
    );
  });
});

describe("saved practice and at a glance", () => {
  it("separates retired sessions from live ones and keeps both", () => {
    const model = buildLearnModel({
      nowIso: NOW,
      progress: progressWith({
        questions: [openDice],
        recentSessions: [
          openDiceSession,
          {
            ...openDiceSession,
            available: false,
            questionId: "spinner-coin",
            questionTitle: "Title for spinner-coin",
            sessionId: "session:retired",
            status: "unavailable",
          },
        ],
      }),
      questions,
      topics,
    });

    expect(model.saved.active.map((row) => row.sessionId)).toEqual([
      "session:dice",
    ]);
    expect(model.saved.active[0].href).toBe(
      "/practice/dice-sum-eight?sessionId=session%3Adice",
    );
    expect(model.saved.retired.map((row) => row.sessionId)).toEqual([
      "session:retired",
    ]);
    expect(model.saved.retired[0].href).toBeUndefined();
  });

  it("breaks the solved count down by the course's difficulty words", () => {
    const model = buildLearnModel({
      nowIso: NOW,
      progress: progressWith({ questions: [solvedVenn] }),
      questions,
      topics,
    });

    expect(model.glance).toMatchObject({ solved: 1, total: 3 });
    expect(model.glance.breakdown).toEqual([
      { label: "Intro", solved: 1, total: 1 },
      { label: "Core", solved: 0, total: 1 },
      { label: "Stretch", solved: 0, total: 1 },
    ]);
  });

  it("renders the practice month as a calendar, starting on Monday", () => {
    const calendar = buildPracticeCalendar(
      NOW,
      new Set(["2026-09-08", "2026-09-10"]),
    );

    expect(calendar.monthLabel).toBe("September 2026");
    expect(calendar.days).toHaveLength(30);
    // 1 September 2026 is a Tuesday, so one blank cell precedes it.
    expect(calendar.leadingBlanks).toBe(1);
    expect(
      calendar.days.filter((day) => day.active).map((day) => day.day),
    ).toEqual([8, 10]);
  });
});

describe("one topic", () => {
  it("counts the topic's own questions and its hint average", () => {
    const model = buildTopicModel({
      nowIso: NOW,
      progress: progressWith({
        questions: [openDice],
        recentSessions: [openDiceSession],
      }),
      questions: questions.filter(
        (item) => item.topicId === "conditional-probability",
      ),
      topic: topics[1],
    });

    expect(model.questions.map((row) => row.position)).toEqual([1, 2]);
    expect(model.about).toMatchObject({
      extraPracticeHref: "/practice?topicId=conditional-probability",
      questionCountLabel: "2 questions",
      weekLabel: "Wk 3",
    });
    expect(model.about.doneLabel).toBe("0 done · 1 hint avg");
  });

  it("accepts only an id that could name a topic", () => {
    expect(isTopicIdShape("conditional-probability")).toBe(true);
    expect(isTopicIdShape("../secrets")).toBe(false);
    expect(isTopicIdShape("Conditional")).toBe(false);
    expect(isTopicIdShape("")).toBe(false);
  });
});

describe("relative time", () => {
  it("is coarse, and resolved before it reaches the browser", () => {
    expect(relativeTimeLabel("2026-09-10T11:59:30.000Z", NOW)).toBe("just now");
    expect(relativeTimeLabel("2026-09-10T11:30:00.000Z", NOW)).toBe("30m ago");
    expect(relativeTimeLabel("2026-09-10T10:00:00.000Z", NOW)).toBe("2h ago");
    expect(relativeTimeLabel("2026-09-08T12:00:00.000Z", NOW)).toBe("2d ago");
    expect(relativeTimeLabel("2026-08-30T12:00:00.000Z", NOW)).toBe(
      "on Aug 30",
    );
  });
});

describe("labels shared by the learn pages", () => {
  it("writes positions and counts in words, one format everywhere", () => {
    expect(questionPositionLabel(2, 5)).toBe("Question 2 of 5");
    expect(solvedCountLabel(3, 8)).toBe("3 of 8 solved");
  });

  it("reads a topic's mastery level only from its solved count", () => {
    expect(topicMasteryLevel({ glyph: "closed", solved: 0, total: 0 })).toBe(
      undefined,
    );
    expect(topicMasteryLevel({ glyph: "todo", solved: 0, total: 4 })).toBe(0);
    expect(topicMasteryLevel({ glyph: "current", solved: 0, total: 4 })).toBe(
      1,
    );
    expect(topicMasteryLevel({ glyph: "current", solved: 1, total: 4 })).toBe(
      2,
    );
    expect(topicMasteryLevel({ glyph: "current", solved: 2, total: 4 })).toBe(
      3,
    );
    expect(topicMasteryLevel({ glyph: "done", solved: 4, total: 4 })).toBe(4);
  });

  it("gives the syllabus rail a mastery level and one up-next topic", () => {
    const model = buildLearnModel({
      nowIso: NOW,
      progress: progressWith({
        questions: [solvedVenn, openDice],
        recentSessions: [openDiceSession],
      }),
      questions,
      topics,
    });

    expect(
      toSyllabusRailTopics(model.topics).map((topic) => [
        topic.id,
        topic.masteryLevel,
        topic.current,
      ]),
    ).toEqual([
      ["introduction", 4, false],
      ["conditional-probability", 1, true],
      ["central-limit-theorem", undefined, false],
    ]);
  });
});
