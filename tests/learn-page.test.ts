import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  buildLearnModel,
  buildPracticeCalendar,
  buildTopicModel,
  buildWeekStrip,
  COURSE_TIME_ZONE,
  isTopicIdShape,
  MASTERY_LEVEL_TITLES,
  nextUnfinishedTopic,
  questionPositionLabel,
  relativeTimeLabel,
  solvedCountLabel,
  topicMasteryLevel,
  weekLabel,
  weekStartIsoFor,
} from "@/components/learn/learn-model";
import { sortQuestionsForSyllabus } from "@/components/learn/learn-order";
import { LearnScreen } from "@/components/learn/learn-screen";
import { toSyllabusRailTopics } from "@/components/learn/learn-syllabus-rail";
import { SyllabusList } from "@/components/learn/syllabus-list";
import { TopicScreen } from "@/components/learn/topic-screen";
import type {
  CourseTopic,
  StudentPracticeQuestion,
  StudentProgressDashboard,
  TutorQuestion,
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

  it("counts solved questions and first-try answers in words, never a percentage", () => {
    const week = buildWeekStrip({
      nowIso: NOW,
      progress: progressWith({ questions: [solvedVenn, openDice] }),
    });

    expect(week.completedThisWeek).toBe(1);
    expect(week.summary).toBe("1 question solved this week · 1 on the first try");
    expect(week.summary).not.toMatch(/%|problem|—/);

    const two = buildWeekStrip({
      nowIso: NOW,
      progress: progressWith({
        questions: [
          solvedVenn,
          {
            ...solvedVenn,
            attemptCount: 3,
            questionId: "dice-sum-eight",
            topicId: "conditional-probability",
          },
        ],
      }),
    });
    expect(two.summary).toBe(
      "2 questions solved this week · 1 on the first try",
    );

    const empty = buildWeekStrip({ nowIso: NOW, progress: progressWith() });
    expect(empty.summary).toBe("No questions solved yet this week");

    const guest = buildWeekStrip({ nowIso: NOW, progress: null });
    expect(guest.days.every((day) => !day.active)).toBe(true);
    expect(guest.summary).toBe("No questions solved yet this week");
  });

  it("decides the day in the course time zone, not in UTC", () => {
    expect(COURSE_TIME_ZONE).toBe("America/New_York");

    // 01:30 UTC on Tuesday 8 September is Monday evening in the course zone.
    const week = buildWeekStrip({
      nowIso: NOW,
      progress: progressWith({
        questions: [
          {
            ...solvedVenn,
            completedAt: "2026-09-08T01:30:00.000Z",
            lastActiveAt: "2026-09-08T01:30:00.000Z",
          },
        ],
      }),
    });
    expect(week.days.map((day) => day.active)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);

    // 02:00 UTC on Monday 7 September is still Sunday there: last week.
    expect(weekStartIsoFor("2026-09-07T02:00:00.000Z")).toBe("2026-08-31");
    const lastWeek = buildWeekStrip({
      nowIso: NOW,
      progress: progressWith({
        questions: [
          {
            ...solvedVenn,
            completedAt: "2026-09-07T02:00:00.000Z",
            lastActiveAt: "2026-09-07T02:00:00.000Z",
          },
        ],
      }),
    });
    expect(lastWeek.completedThisWeek).toBe(0);
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

  it("keeps a browser with anonymous practice a guest: guest is the owner kind, not missing progress", () => {
    const anonymous = buildLearnModel({
      isGuest: true,
      nowIso: NOW,
      progress: progressWith({ questions: [solvedVenn] }),
      questions,
      topics,
    });
    expect(anonymous.isGuest).toBe(true);
    expect(anonymous.glance.solved).toBe(1);

    const signedIn = buildLearnModel({
      isGuest: false,
      nowIso: NOW,
      progress: progressWith(),
      questions,
      topics,
    });
    expect(signedIn.isGuest).toBe(false);

    const topic = buildTopicModel({
      isGuest: true,
      nowIso: NOW,
      progress: progressWith({ questions: [openDice] }),
      questions: questions.filter(
        (item) => item.topicId === "conditional-probability",
      ),
      topic: topics[1],
    });
    expect(topic.isGuest).toBe(true);
  });

  it("orders questions inside a topic Intro, Core, Stretch before the title", () => {
    const tutorQuestion = (
      id: string,
      difficulty: TutorQuestion["difficulty"],
      title: string,
    ) =>
      ({
        difficulty,
        id,
        title,
        topicId: "conditional-probability",
      }) as TutorQuestion;

    const ordered = sortQuestionsForSyllabus([
      tutorQuestion("q-stretch", "challenge", "A stretch question"),
      tutorQuestion("q-core-b", "intermediate", "B core question"),
      tutorQuestion("q-intro", "foundational", "Z intro question"),
      tutorQuestion("q-core-a", "intermediate", "A core question"),
    ]);

    expect(ordered.map((item) => item.id)).toEqual([
      "q-intro",
      "q-core-a",
      "q-core-b",
      "q-stretch",
    ]);
  });
});

describe("what to continue", () => {
  it("continues the live session and offers a skip to the next untouched question in the same topic", () => {
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
      eyebrow: "Week 3 · Conditional Probability",
      kind: "resume",
      primary: {
        href: "/practice/dice-sum-eight?sessionId=session%3Adice",
        label: "Continue question 1",
      },
      questionTitle: "Title for dice-sum-eight",
      secondary: {
        href: "/practice/spinner-coin",
        label: "Skip to question 2",
      },
    });
    expect(model.continueCard.detail).toContain("1 hint used");
    expect(model.continueCard.detail).toContain("last opened 2 hours ago");
    // Codes are hidden from students.
    expect(model.continueCard.detail).not.toMatch(/Q-/);
  });

  it("offers no skip when the next untouched question is in another topic", () => {
    const model = buildLearnModel({
      nowIso: NOW,
      progress: progressWith({
        questions: [
          { ...openDice, questionId: "venn-union", topicId: "introduction" },
        ],
        recentSessions: [
          {
            ...openDiceSession,
            questionId: "venn-union",
            topicId: "introduction",
          },
        ],
      }),
      questions,
      topics,
    });

    expect(model.continueCard).toMatchObject({
      kind: "resume",
      primary: { label: "Continue question 1" },
    });
    expect(model.continueCard.secondary).toBeUndefined();
  });

  it("says which question to start when nothing is in progress", () => {
    const model = buildLearnModel({
      nowIso: NOW,
      progress: progressWith({ questions: [solvedVenn] }),
      questions,
      topics,
    });

    expect(model.continueCard).toMatchObject({
      eyebrow: "Week 3 · Conditional Probability",
      kind: "start",
      primary: { href: "/practice/dice-sum-eight", label: "Start question 1" },
    });
    expect(model.continueCard.detail).toBe("Core · 3 hints");
    expect(model.continueCard.message).toBeUndefined();
    expect(model.continueCard.secondary).toBeUndefined();
  });

  it("never points a finished course back at a solved question", () => {
    const solvedAll = ["venn-union", "dice-sum-eight", "spinner-coin"].map(
      (questionId) => ({
        ...solvedVenn,
        questionId,
        topicId: questionId === "venn-union" ? "introduction" : "conditional-probability",
      }),
    );
    const model = buildLearnModel({
      nowIso: NOW,
      progress: progressWith({ questions: solvedAll }),
      questions,
      topics,
    });

    expect(model.continueCard).toEqual({
      kind: "complete",
      message: "You've solved every question on the syllabus.",
      primary: { href: "/practice", label: "Keep practicing" },
    });
    expect(model.topics.some((topic) => topic.isCurrent)).toBe(false);
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

  it("lists in-progress practice before solved practice", () => {
    const model = buildLearnModel({
      nowIso: NOW,
      progress: progressWith({
        recentSessions: [
          {
            ...openDiceSession,
            questionId: "venn-union",
            sessionId: "session:solved",
            status: "completed",
          },
          openDiceSession,
        ],
      }),
      questions,
      topics,
    });

    expect(model.saved.active.map((row) => row.sessionId)).toEqual([
      "session:dice",
      "session:solved",
    ]);
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
  it("counts the topic's own questions and the hints used so far", () => {
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
      weekLabel: "Week 3",
    });
    expect(model.weekLabel).toBe("Week 3");
    expect(model.about.doneLabel).toBe("1 hint used so far");

    const untouched = buildTopicModel({
      nowIso: NOW,
      progress: progressWith(),
      questions: questions.filter(
        (item) => item.topicId === "conditional-probability",
      ),
      topic: topics[1],
    });
    expect(untouched.about.doneLabel).toBe("");
  });

  it("points a finished topic at the next unfinished topic, or nowhere", () => {
    const model = buildLearnModel({
      nowIso: NOW,
      progress: progressWith({ questions: [solvedVenn] }),
      questions,
      topics,
    });

    expect(nextUnfinishedTopic(model.topics, "introduction")?.id).toBe(
      "conditional-probability",
    );
    // Wraps to an earlier unfinished topic, and skips topics with nothing in them.
    expect(
      nextUnfinishedTopic(model.topics, "central-limit-theorem")?.id,
    ).toBe("conditional-probability");
    expect(
      nextUnfinishedTopic(
        model.topics.map((topic) => ({ ...topic, solved: topic.total })),
        "introduction",
      ),
    ).toBeUndefined();
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
    expect(relativeTimeLabel("2026-09-10T11:59:00.000Z", NOW)).toBe(
      "1 minute ago",
    );
    expect(relativeTimeLabel("2026-09-10T11:30:00.000Z", NOW)).toBe(
      "30 minutes ago",
    );
    expect(relativeTimeLabel("2026-09-10T11:00:00.000Z", NOW)).toBe(
      "1 hour ago",
    );
    expect(relativeTimeLabel("2026-09-10T10:00:00.000Z", NOW)).toBe(
      "2 hours ago",
    );
    expect(relativeTimeLabel("2026-09-08T12:00:00.000Z", NOW)).toBe(
      "2 days ago",
    );
    expect(relativeTimeLabel("2026-08-30T12:00:00.000Z", NOW)).toBe(
      "on Aug 30",
    );
  });
});

describe("labels shared by the learn pages", () => {
  it("writes positions, weeks and counts in words, one format everywhere", () => {
    expect(questionPositionLabel(2, 5)).toBe("Question 2 of 5");
    expect(solvedCountLabel(3, 8)).toBe("3 of 8 solved");
    expect(weekLabel(3)).toBe("Week 3");
    expect(MASTERY_LEVEL_TITLES[2]).toBe("Familiar: under half solved");
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
        topic.meta,
      ]),
    ).toEqual([
      ["introduction", 4, false, undefined],
      ["conditional-probability", 1, true, undefined],
      ["central-limit-theorem", undefined, false, "none yet"],
    ]);
  });
});

describe("the rendered learn pages", () => {
  const liveProgress = () =>
    progressWith({
      questions: [solvedVenn, openDice],
      recentSessions: [openDiceSession],
    });

  it("prints the week in words, the solved count with its noun, and one Up next chip", () => {
    const model = buildLearnModel({
      nowIso: NOW,
      progress: liveProgress(),
      questions,
      topics,
    });
    const markup = renderToStaticMarkup(
      createElement(SyllabusList, {
        emptyMessage: "No topic matches that search.",
        topics: model.topics,
      }),
    );

    expect(markup).toContain(">Week 3<");
    expect(markup).not.toMatch(/Wk \d/);
    expect(markup).toContain("<span>0 of 2</span> solved");
    expect(markup).not.toContain("sr-only");
    expect(markup.match(/Up next/g)).toHaveLength(1);
    expect(markup).not.toContain("You are here");
    expect(markup).toContain('title="Attempted: opened, none solved yet"');
  });

  it("shows /learn without a second syllabus, with search only, and hides empty trackers from a new guest", () => {
    const guest = buildLearnModel({
      isGuest: true,
      nowIso: NOW,
      progress: null,
      questions,
      topics,
    });
    const guestMarkup = renderToStaticMarkup(
      createElement(LearnScreen, { model: guest }),
    );

    expect(guestMarkup).not.toContain('data-slot="three-column-rail"');
    expect(guestMarkup).toContain("Guest · your progress lives in this browser.");
    expect(guestMarkup).toContain("Sign in to keep it");
    expect(guestMarkup).toContain('href="/sign-in?callbackUrl=%2Flearn"');
    expect(guestMarkup).toContain("Have a section code?");
    expect(guestMarkup).toContain('href="/join"');
    expect(guestMarkup).toContain("Start question 1");
    expect(guestMarkup).not.toContain("This week");
    expect(guestMarkup).not.toContain("At a glance");
    expect(guestMarkup).toContain("Search topics");
    expect(guestMarkup).not.toContain("Filter topics");
    expect(guestMarkup).not.toContain("Random question");
    expect(guestMarkup).not.toMatch(/Start here|Next new|Resume →|Q-[0-9A-F]{4}/);

    const student = buildLearnModel({
      isGuest: false,
      nowIso: NOW,
      progress: liveProgress(),
      questions,
      topics,
    });
    const studentMarkup = renderToStaticMarkup(
      createElement(LearnScreen, { model: student }),
    );

    expect(studentMarkup).not.toContain("Guest ·");
    expect(studentMarkup).toContain("Continue question 1");
    expect(studentMarkup).toContain("Skip to question 2");
    expect(studentMarkup).toContain("This week");
    expect(studentMarkup).toContain(
      "1 question solved this week · 1 on the first try",
    );
    expect(studentMarkup).toContain("Recent practice");
    expect(studentMarkup).not.toContain("Saved practice");
    expect(studentMarkup).toContain("At a glance");
    expect(
      studentMarkup.indexOf("Recent practice"),
    ).toBeLessThan(studentMarkup.indexOf('id="learn-syllabus"'));
    expect(studentMarkup.lastIndexOf("At a glance")).toBeGreaterThan(
      studentMarkup.indexOf('id="learn-syllabus"'),
    );
  });

  it("names the complete course and offers more practice", () => {
    const model = buildLearnModel({
      nowIso: NOW,
      progress: progressWith({
        questions: [
          solvedVenn,
          { ...solvedVenn, questionId: "dice-sum-eight", topicId: "conditional-probability" },
          { ...solvedVenn, questionId: "spinner-coin", topicId: "conditional-probability" },
        ],
      }),
      questions,
      topics,
    });
    const markup = renderToStaticMarkup(createElement(LearnScreen, { model }));

    expect(markup).toContain("You&#x27;ve solved every question on the syllabus.");
    expect(markup).toContain("Keep practicing");
    expect(markup).toContain('href="/practice"');
  });

  it("gives a topic in progress one next step, no codes, no toolbar for a short list, and a bottom bar on phones", () => {
    const syllabus = buildLearnModel({
      isGuest: true,
      nowIso: NOW,
      progress: liveProgress(),
      questions,
      topics,
    });
    const model = buildTopicModel({
      isGuest: true,
      nowIso: NOW,
      progress: liveProgress(),
      questions: questions.filter(
        (item) => item.topicId === "conditional-probability",
      ),
      topic: topics[1],
    });
    const markup = renderToStaticMarkup(
      createElement(TopicScreen, { model, topics: syllabus.topics }),
    );

    expect(markup).toContain(">Week 3<");
    expect(markup).toContain("Continue question 1");
    expect(markup).toContain('data-slot="bottom-bar"');
    expect(markup).toContain("Up next");
    expect(markup).not.toMatch(/Q-[0-9A-F]{4}|Resume|You are here/);
    expect(markup).not.toContain("Search questions");
    expect(markup).not.toContain("Random question");
    expect(markup).toContain("Guest · your progress lives in this browser.");
    expect(markup).toContain(
      'href="/sign-in?callbackUrl=%2Flearn%2Fconditional-probability"',
    );
    expect(markup).toContain("More questions like these. They don’t change your syllabus progress.");
    expect(markup).toContain("Try extra practice");
    expect(markup).toContain("1 hint used so far");
    expect(markup).not.toMatch(/hint avg|\bdone\b/);
    // The rail marks an empty topic with a reason, not a blank ring.
    expect(markup).toContain("none yet");
  });

  it("points a finished topic forward instead of leaving a dead end", () => {
    const solvedTopic = progressWith({
      questions: [
        { ...solvedVenn, questionId: "dice-sum-eight", topicId: "conditional-probability" },
        { ...solvedVenn, questionId: "spinner-coin", topicId: "conditional-probability" },
      ],
    });
    const syllabus = buildLearnModel({
      nowIso: NOW,
      progress: solvedTopic,
      questions,
      topics,
    });
    const model = buildTopicModel({
      nowIso: NOW,
      progress: solvedTopic,
      questions: questions.filter(
        (item) => item.topicId === "conditional-probability",
      ),
      topic: topics[1],
    });
    const next = nextUnfinishedTopic(syllabus.topics, model.id);
    expect(next?.id).toBe("introduction");

    const markup = renderToStaticMarkup(
      createElement(TopicScreen, {
        model,
        nextTopic: next
          ? { href: next.href, title: next.title, weekNumber: next.weekNumber }
          : undefined,
        topics: syllabus.topics,
      }),
    );

    expect(markup).toContain(
      "Next topic: Week 1 · Introduction to Probability →",
    );
    expect(markup).toContain('href="/learn/introduction"');
    expect(markup).toContain("Topic complete: 2 of 2 solved");
    expect(markup).toContain(">Extra practice<");

    const last = renderToStaticMarkup(
      createElement(TopicScreen, { model, topics: syllabus.topics }),
    );
    expect(last).toContain("Back to Learn");
    expect(last).not.toContain("Next topic");
  });
});
