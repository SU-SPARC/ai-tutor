import {
  questionCode,
  studentDifficultyLabel,
  studentQuestionTitle,
} from "@/lib/labels";
import type {
  CourseTopic,
  Difficulty,
  StudentPracticeQuestion,
  StudentProgressDashboard,
} from "@/lib/types";

/**
 * The derived model behind `/learn` and `/learn/[topic]`.
 *
 * Everything here is a pure function of (topics, questions, progress, nowIso)
 * so that the two server pages can compute it once and hand plain props to the
 * client screens — and so the week strip, the statuses, and the continue
 * selection can be unit-tested without rendering anything.
 *
 * `nowIso` is always passed in: a client component must never read the clock
 * during render, and a server component must be the only place "today" is
 * decided.
 */

export type QuestionStatus = "done" | "current" | "todo" | "retired";

export type TopicGlyph = "done" | "current" | "todo" | "closed";

export type LearnQuestionRow = {
  attemptCount: number;
  difficulty: Difficulty;
  /** Intro / Core / Stretch — course words, never colour-coded. */
  difficultyLabel: string;
  hintCount: number;
  hintsUsed: number;
  href: string;
  id: string;
  /** 1-based position inside its own topic. */
  position: number;
  prompt: string;
  questionCode: string;
  status: QuestionStatus;
  title: string;
  topicId: string;
};

export type LearnTopicRow = {
  /**
   * The week's end date (ISO). Once it passes the week is closed: still
   * listed, still a link, still practicable, and labelled so.
   */
  closesAt?: string;
  /**
   * "Closed" / "Closes" before the week's end date, for a topic with
   * questions. The date itself is printed by the client in the student's own
   * time zone (`LocalDate`), so the model carries only the word and the ISO.
   */
  closeLabel?: "Closed" | "Closes";
  description: string;
  glyph: TopicGlyph;
  href: string;
  id: string;
  /** 1-based position in canonical syllabus order — rendered as "01". */
  index: number;
  isCurrent: boolean;
  /**
   * "no questions yet" for a topic with nothing published (the rail says
   * "none yet"). A closing or closed week uses `closeLabel` + `closesAt`.
   */
  meta?: string;
  solved: number;
  title: string;
  total: number;
  weekNumber: number;
};

export type ContinueCard = {
  detail?: string;
  eyebrow?: string;
  /**
   * resume: a live question to continue; start: the first question with work
   * left in it; complete: every question on the syllabus is solved; empty:
   * nothing is published yet.
   */
  kind: "resume" | "start" | "complete" | "empty";
  message?: string;
  primary?: { href: string; label: string };
  questionTitle?: string;
  secondary?: { href: string; label: string };
};

export type WeekStripDay = {
  active: boolean;
  iso: string;
  isToday: boolean;
  label: string;
};

export type WeekStrip = {
  completedThisWeek: number;
  days: WeekStripDay[];
  firstTryLabel: string;
  summary: string;
};

export type SavedPracticeRow = {
  attemptCount: number;
  hintsUsed: number;
  href?: string;
  isExtraPractice: boolean;
  prompt: string;
  questionCode: string;
  sessionId: string;
  status: "completed" | "in_progress" | "unavailable";
  title: string;
  topicLabel: string;
};

export type SavedPractice = {
  active: SavedPracticeRow[];
  retired: SavedPracticeRow[];
};

export type GlanceBreakdownRow = {
  label: string;
  solved: number;
  total: number;
};

export type PracticeCalendar = {
  days: Array<{ active: boolean; day: number }>;
  leadingBlanks: number;
  monthLabel: string;
};

export type Glance = {
  breakdown: GlanceBreakdownRow[];
  calendar: PracticeCalendar;
  solved: number;
  total: number;
};

export type LearnModel = {
  continueCard: ContinueCard;
  glance: Glance;
  isGuest: boolean;
  questions: LearnQuestionRow[];
  saved: SavedPractice;
  topics: LearnTopicRow[];
  week: WeekStrip;
};

export type TopicAbout = {
  /** "2 hints used so far", "No hints used so far", or "" before any work. */
  doneLabel: string;
  extraPracticeHref: string;
  questionCountLabel: string;
  weekLabel: string;
};

export type TopicModel = {
  about: TopicAbout;
  /** Set when the week's end date has passed (ISO): the week is closed. */
  closedAt?: string;
  description: string;
  id: string;
  isGuest: boolean;
  questions: LearnQuestionRow[];
  title: string;
  weekLabel: string;
  weekNumber: number;
};

export type LearnModelInput = {
  /**
   * Whether this visitor is a guest (anything but a signed-in user), decided
   * by the page from the owner kind: a browser with anonymous practice has
   * progress and is still a guest. Defaults to `progress === null`.
   */
  isGuest?: boolean;
  nowIso: string;
  progress: StudentProgressDashboard | null;
  questions: StudentPracticeQuestion[];
  topics: CourseTopic[];
};

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"] as const;
const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;
const DIFFICULTY_ORDER: Difficulty[] = [
  "foundational",
  "intermediate",
  "challenge",
];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;
const SHORT_MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
/**
 * The course's own clock. "Today", "this week" and the practice calendar are
 * decided in this zone, never in UTC, so an evening session still lands on
 * the day the student practised.
 */
export const COURSE_TIME_ZONE = "America/New_York";

const COURSE_DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  timeZone: COURSE_TIME_ZONE,
  year: "numeric",
});

/**
 * What each mastery level means, for the chip's `title`. The levels are a
 * reading of the solved count, not a grade, so each one says so.
 */
export const MASTERY_LEVEL_TITLES: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: "Not started: nothing opened yet",
  1: "Attempted: opened, none solved yet",
  2: "Familiar: under half solved",
  3: "Proficient: half or more solved",
  4: "Mastered: every question solved",
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A topic id as it may appear in a URL segment. */
export const TOPIC_ID_PATTERN = /^[a-z0-9-]{1,80}$/;

export function isTopicIdShape(value: string) {
  return TOPIC_ID_PATTERN.test(value);
}

export function topicHref(topicId: string) {
  return `/learn/${encodeURIComponent(topicId)}`;
}

export function practiceHref(questionId: string, sessionId?: string) {
  const base = `/practice/${encodeURIComponent(questionId)}`;
  return sessionId
    ? `${base}?sessionId=${encodeURIComponent(sessionId)}`
    : base;
}

/** "Week 3": the week label used as an eyebrow everywhere. Never "Wk". */
export function weekLabel(weekNumber: number) {
  return `Week ${weekNumber}`;
}

/** "Start question 3" (untouched) / "Continue question 3" (in progress). */
export function questionActionLabel(question: {
  position: number;
  status: QuestionStatus;
}) {
  return `${question.status === "current" ? "Continue" : "Start"} question ${
    question.position
  }`;
}

/**
 * "Question 2 of 5" — the one position format, shared with the practice
 * page, so a question is never "2/5" in one place and "2 of 5" in another.
 */
export function questionPositionLabel(position: number, total: number) {
  return `Question ${position} of ${total}`;
}

/** "3 of 8 solved": counts in words, never a percentage on its own. */
export function solvedCountLabel(solved: number, total: number) {
  return `${solved} of ${total} solved`;
}

/**
 * The topic's mastery level (0-4) for `MasteryChip` / `MasteryPip`, or
 * `undefined` for a topic with nothing published (it has no level to show).
 *
 * The course has no grading rule for mastery, so this is only a reading of
 * the solved count, and every level can be said in words from the same two
 * numbers the row already prints:
 * - 0 Not started: nothing opened in the topic
 * - 1 Attempted: opened, nothing solved yet
 * - 2 Familiar: fewer than half solved
 * - 3 Proficient: half or more solved
 * - 4 Mastered: every question solved
 */
export function topicMasteryLevel(topic: {
  glyph: TopicGlyph;
  solved: number;
  total: number;
}): 0 | 1 | 2 | 3 | 4 | undefined {
  if (topic.total <= 0) {
    return undefined;
  }
  if (topic.solved >= topic.total) {
    return 4;
  }
  if (topic.solved <= 0) {
    return topic.glyph === "current" ? 1 : 0;
  }
  return topic.solved * 2 >= topic.total ? 3 : 2;
}

/**
 * The Monday (in the course time zone) of the week containing `nowIso`, as a
 * `YYYY-MM-DD` date.
 */
export function weekStartIsoFor(nowIso: string) {
  const today = courseDayKey(nowIso);
  return addDays(today, -mondayOffset(weekdayOf(today)));
}

/**
 * Relative time, resolved on the server so the string that reaches the browser
 * is already a string. Deliberately coarse and in words: a student needs
 * "2 hours ago", never "2h ago" or "2 hours and 14 minutes ago".
 */
export function relativeTimeLabel(iso: string, nowIso: string) {
  const then = new Date(iso).getTime();
  const now = new Date(nowIso).getTime();

  if (Number.isNaN(then) || Number.isNaN(now)) {
    return "";
  }

  const elapsed = now - then;

  if (elapsed < MINUTE) {
    return "just now";
  }
  if (elapsed < HOUR) {
    return unitsAgo(Math.floor(elapsed / MINUTE), "minute");
  }
  if (elapsed < DAY) {
    return unitsAgo(Math.floor(elapsed / HOUR), "hour");
  }
  if (elapsed < 7 * DAY) {
    return unitsAgo(Math.floor(elapsed / DAY), "day");
  }

  const [, month, day] = courseDayKey(iso).split("-").map(Number);
  return `on ${SHORT_MONTH_NAMES[month - 1]} ${day}`;
}

function unitsAgo(count: number, unit: string) {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

export function buildLearnModel(input: LearnModelInput): LearnModel {
  const { nowIso, progress, questions, topics } = input;
  const rows = buildQuestionRows(questions, progress);
  const topicRows = buildTopicRows(topics, rows, nowIso);
  const currentTopicId = pickCurrentTopicId(topicRows, rows, progress);

  return {
    continueCard: buildContinueCard({ nowIso, progress, rows, topics }),
    glance: buildGlance({ nowIso, progress, rows }),
    isGuest: input.isGuest ?? progress === null,
    questions: rows,
    saved: buildSavedPractice(progress, questions, topics),
    topics: topicRows.map((topic) => ({
      ...topic,
      isCurrent: topic.id === currentTopicId,
    })),
    week: buildWeekStrip({ nowIso, progress }),
  };
}

export function buildTopicModel(input: {
  /** See `LearnModelInput.isGuest`. Defaults to `progress === null`. */
  isGuest?: boolean;
  nowIso: string;
  progress: StudentProgressDashboard | null;
  questions: StudentPracticeQuestion[];
  topic: CourseTopic;
}): TopicModel {
  const { nowIso, progress, questions, topic } = input;
  const rows = buildQuestionRows(questions, progress).filter(
    (question) => question.topicId === topic.id,
  );
  const hintsUsed = rows.reduce(
    (total, question) => total + question.hintsUsed,
    0,
  );
  const touched = rows.filter(
    (question) => question.attemptCount > 0 || question.hintsUsed > 0,
  ).length;

  return {
    about: {
      // The header already prints "2 of 5 solved"; this line only adds what
      // the header does not say, and nothing before the first attempt.
      doneLabel:
        touched === 0
          ? ""
          : hintsUsed === 0
            ? "No hints used so far"
            : `${hintsUsed} hint${hintsUsed === 1 ? "" : "s"} used so far`,
      extraPracticeHref: `/practice?topicId=${encodeURIComponent(topic.id)}`,
      questionCountLabel:
        rows.length === 1 ? "1 question" : `${rows.length} questions`,
      weekLabel: weekLabel(topic.weekNumber),
    },
    closedAt:
      rows.length > 0 && isPast(topic.closesAt, nowIso)
        ? topic.closesAt
        : undefined,
    description: topic.description,
    id: topic.id,
    isGuest: input.isGuest ?? progress === null,
    questions: rows,
    title: topic.title,
    weekLabel: weekLabel(topic.weekNumber),
    weekNumber: topic.weekNumber,
  };
}

export function buildQuestionRows(
  questions: StudentPracticeQuestion[],
  progress: StudentProgressDashboard | null,
): LearnQuestionRow[] {
  const byQuestionId = new Map(
    (progress?.questions ?? []).map((question) => [
      question.questionId,
      question,
    ]),
  );
  const retiredIds = new Set(
    (progress?.recentSessions ?? [])
      .filter((session) => session.status === "unavailable")
      .map((session) => session.questionId),
  );
  const positionByTopic = new Map<string, number>();

  return questions.map((question) => {
    const position = (positionByTopic.get(question.topicId) ?? 0) + 1;
    positionByTopic.set(question.topicId, position);

    const tracked = byQuestionId.get(question.id);
    const status: QuestionStatus = retiredIds.has(question.id)
      ? "retired"
      : tracked?.status === "completed"
        ? "done"
        : tracked
          ? "current"
          : "todo";

    return {
      attemptCount: tracked?.attemptCount ?? 0,
      difficulty: question.difficulty,
      difficultyLabel: studentDifficultyLabel(question.difficulty),
      hintCount: question.hintCount,
      hintsUsed: tracked?.hintsUsed ?? 0,
      href: practiceHref(question.id, tracked?.resumeSessionId),
      id: question.id,
      position,
      prompt: question.prompt,
      questionCode: questionCode(question.id),
      status,
      title: studentQuestionTitle(question.title),
      topicId: question.topicId,
    };
  });
}

function buildTopicRows(
  topics: CourseTopic[],
  rows: LearnQuestionRow[],
  nowIso: string,
): LearnTopicRow[] {
  return topics.map((topic, index) => {
    const own = rows.filter((question) => question.topicId === topic.id);
    const solved = own.filter((question) => question.status === "done").length;
    const started = own.some((question) => question.status === "current");
    const total = own.length;
    // A passed end date closes the week but keeps it a link (migration 030).
    const closeLabel =
      total === 0 || !validIso(topic.closesAt)
        ? undefined
        : isPast(topic.closesAt, nowIso)
          ? "Closed"
          : "Closes";

    return {
      closeLabel,
      closesAt: closeLabel ? topic.closesAt : undefined,
      description: topic.description,
      glyph: topicGlyph({ solved, started, total }),
      href: topicHref(topic.id),
      id: topic.id,
      index: index + 1,
      isCurrent: false,
      meta: total === 0 ? "no questions yet" : undefined,
      solved,
      title: topic.title,
      total,
      weekNumber: topic.weekNumber,
    };
  });
}

function validIso(value: string | undefined): value is string {
  return value !== undefined && !Number.isNaN(new Date(value).getTime());
}

/** Whether `value` is at or before `nowIso`; false when missing or invalid. */
function isPast(value: string | undefined, nowIso: string) {
  if (!validIso(value)) {
    return false;
  }
  return new Date(value).getTime() <= new Date(nowIso).getTime();
}

function topicGlyph(input: {
  solved: number;
  started: boolean;
  total: number;
}): TopicGlyph {
  if (input.total === 0) {
    return "closed";
  }
  if (input.solved === input.total) {
    return "done";
  }
  if (input.started || input.solved > 0) {
    return "current";
  }
  return "todo";
}

/**
 * "Up next": the topic the student is actually inside, which is the topic of
 * whatever they would continue. With nothing in progress it falls back to the
 * first topic that still has work in it, the same place the Continue card
 * points.
 */
function pickCurrentTopicId(
  topics: LearnTopicRow[],
  rows: LearnQuestionRow[],
  progress: StudentProgressDashboard | null,
) {
  const resumable = resumableQuestion(rows, progress);
  if (resumable) {
    return resumable.topicId;
  }

  const unfinished = topics.find(
    (topic) => topic.total > 0 && topic.solved < topic.total,
  );
  return unfinished?.id;
}

function resumableQuestion(
  rows: LearnQuestionRow[],
  progress: StudentProgressDashboard | null,
) {
  if (!progress) {
    return undefined;
  }

  // The same rule the old progress dashboard used: the most recent live
  // session on an assigned question, then anything answered incorrectly.
  const session = progress.recentSessions.find(
    (candidate) =>
      candidate.available &&
      candidate.status === "in_progress" &&
      candidate.practiceContext !== "reserve_practice",
  );
  const fromSession = session
    ? rows.find((row) => row.id === session.questionId)
    : undefined;
  if (fromSession) {
    return fromSession;
  }

  const retry = progress.questions.find(
    (question) => question.available && question.needsAnotherAttempt,
  );
  return retry ? rows.find((row) => row.id === retry.questionId) : undefined;
}

function buildContinueCard(input: {
  nowIso: string;
  progress: StudentProgressDashboard | null;
  rows: LearnQuestionRow[];
  topics: CourseTopic[];
}): ContinueCard {
  const { nowIso, progress, rows, topics } = input;
  const topicsById = new Map(topics.map((topic) => [topic.id, topic]));
  const firstTodo = rows.find((row) => row.status === "todo");
  const resume = resumableQuestion(rows, progress);

  if (resume) {
    const topic = topicsById.get(resume.topicId);
    const lastSeen = progress?.questions.find(
      (question) => question.questionId === resume.id,
    )?.lastActiveAt;

    // "Skip to question 4" only when the first untouched question sits in
    // the same topic: a jump to another week would be a surprise.
    const skipTo =
      firstTodo &&
      firstTodo.topicId === resume.topicId &&
      firstTodo.id !== resume.id
        ? firstTodo
        : undefined;

    return {
      detail: [
        hintsUsedLabel(resume.hintsUsed),
        lastSeen ? `last opened ${relativeTimeLabel(lastSeen, nowIso)}` : "",
      ]
        .filter((part) => part.length > 0)
        .join(" · "),
      eyebrow: topic
        ? `${weekLabel(topic.weekNumber)} · ${topic.title}`
        : undefined,
      kind: "resume",
      primary: {
        href: resume.href,
        label: `Continue question ${resume.position}`,
      },
      questionTitle: resume.title,
      secondary: skipTo
        ? { href: skipTo.href, label: `Skip to question ${skipTo.position}` }
        : undefined,
    };
  }

  // The first question with work left in it, never a solved or removed one.
  const start = rows.find(
    (row) => row.status === "todo" || row.status === "current",
  );

  if (!start) {
    if (rows.some((row) => row.status === "done")) {
      return {
        kind: "complete",
        message: "You've solved every question on the syllabus.",
        primary: { href: "/practice", label: "Keep practicing" },
      };
    }
    return {
      kind: "empty",
      message:
        "No practice questions are available yet. Your professor adds them as they are reviewed.",
    };
  }

  const topic = topicsById.get(start.topicId);

  return {
    detail: [start.difficultyLabel, hintsAvailableLabel(start.hintCount)]
      .filter((part) => part.length > 0)
      .join(" · "),
    eyebrow: topic
      ? `${weekLabel(topic.weekNumber)} · ${topic.title}`
      : undefined,
    kind: "start",
    primary: { href: start.href, label: questionActionLabel(start) },
    questionTitle: start.title,
  };
}

export function buildWeekStrip(input: {
  nowIso: string;
  progress: StudentProgressDashboard | null;
}): WeekStrip {
  const { nowIso, progress } = input;
  const weekStart = weekStartIsoFor(nowIso);
  const todayKey = courseDayKey(nowIso);
  const activeDays = practiceDayKeys(progress);
  const days: WeekStripDay[] = DAY_LABELS.map((label, index) => {
    const iso = addDays(weekStart, index);
    return {
      active: activeDays.has(iso),
      iso,
      isToday: iso === todayKey,
      label,
    };
  });

  const weekEnd = addDays(weekStart, 7);
  const completed = (progress?.questions ?? []).filter((question) => {
    if (question.status !== "completed") {
      return false;
    }
    const key = courseDayKey(question.completedAt ?? question.lastActiveAt);
    return key >= weekStart && key < weekEnd;
  });
  const firstTry = completed.filter(
    (question) => question.attemptCount === 1,
  ).length;
  // A count, never a percentage: "on the first try" is a record, not a grade.
  const firstTryLabel = `${firstTry} on the first try`;

  return {
    completedThisWeek: completed.length,
    days,
    firstTryLabel,
    summary:
      completed.length === 0
        ? "No questions solved yet this week"
        : `${completed.length} ${
            completed.length === 1 ? "question" : "questions"
          } solved this week · ${firstTryLabel}`,
  };
}

function buildSavedPractice(
  progress: StudentProgressDashboard | null,
  questions: StudentPracticeQuestion[],
  topics: CourseTopic[],
): SavedPractice {
  const promptById = new Map(
    questions.map((question) => [question.id, question.prompt]),
  );
  const topicsById = new Map(topics.map((topic) => [topic.id, topic]));
  const active: SavedPracticeRow[] = [];
  const retired: SavedPracticeRow[] = [];

  for (const session of progress?.recentSessions ?? []) {
    const topic = topicsById.get(session.topicId);
    const row: SavedPracticeRow = {
      attemptCount: session.attemptCount,
      hintsUsed: session.hintsUsed,
      href: session.available
        ? session.practiceContext === "reserve_practice"
          ? `/practice?sessionId=${encodeURIComponent(session.sessionId)}`
          : practiceHref(session.questionId, session.sessionId)
        : undefined,
      isExtraPractice: session.practiceContext === "reserve_practice",
      prompt:
        promptById.get(session.questionId) ??
        studentQuestionTitle(session.questionTitle),
      questionCode: questionCode(session.questionId),
      sessionId: session.sessionId,
      status: session.status,
      title: studentQuestionTitle(session.questionTitle),
      topicLabel: topic
        ? `${weekLabel(topic.weekNumber)} · ${topic.title}`
        : session.topicTitle,
    };

    if (session.status === "unavailable") {
      retired.push(row);
    } else {
      active.push(row);
    }
  }

  // In-progress work first (it is what a student comes back for), then the
  // solved rows; each group keeps its most-recent-first order.
  const inProgress = active.filter((row) => row.status === "in_progress");
  const rest = active.filter((row) => row.status !== "in_progress");

  return { active: [...inProgress, ...rest], retired };
}

function buildGlance(input: {
  nowIso: string;
  progress: StudentProgressDashboard | null;
  rows: LearnQuestionRow[];
}): Glance {
  const { nowIso, progress, rows } = input;

  return {
    breakdown: DIFFICULTY_ORDER.map((difficulty) => {
      const own = rows.filter((row) => row.difficulty === difficulty);
      return {
        label: studentDifficultyLabel(difficulty),
        solved: own.filter((row) => row.status === "done").length,
        total: own.length,
      };
    }),
    calendar: buildPracticeCalendar(nowIso, practiceDayKeys(progress)),
    solved: rows.filter((row) => row.status === "done").length,
    total: rows.length,
  };
}

/**
 * Which days this student practised, as a calendar of the current month —
 * a record, not a streak: nothing is lost by a gap.
 */
export function buildPracticeCalendar(
  nowIso: string,
  activeDays: ReadonlySet<string>,
): PracticeCalendar {
  const [year, monthNumber] = courseDayKey(nowIso).split("-").map(Number);
  const month = monthNumber - 1;
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const dayCount = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return {
    days: Array.from({ length: dayCount }, (_, index) => {
      const day = index + 1;
      return {
        active: activeDays.has(isoDate(new Date(Date.UTC(year, month, day)))),
        day,
      };
    }),
    leadingBlanks: mondayOffset(firstOfMonth.getUTCDay()),
    monthLabel: `${MONTH_NAMES[month]} ${year}`,
  };
}

/** The full weekday name for a strip dot's aria label ("M" twice is not a name). */
export function weekDayName(index: number) {
  return DAY_NAMES[index] ?? "";
}

function practiceDayKeys(progress: StudentProgressDashboard | null) {
  const keys = new Set<string>();

  for (const session of progress?.recentSessions ?? []) {
    keys.add(courseDayKey(session.lastSeenAt));
  }
  for (const question of progress?.questions ?? []) {
    keys.add(courseDayKey(question.lastActiveAt));
  }

  return keys;
}

function hintsUsedLabel(hintsUsed: number) {
  if (hintsUsed <= 0) {
    return "no hints used";
  }
  return `${hintsUsed} hint${hintsUsed === 1 ? "" : "s"} used`;
}

function hintsAvailableLabel(hintCount: number) {
  if (hintCount <= 0) {
    return "";
  }
  return `${hintCount} hint${hintCount === 1 ? "" : "s"}`;
}

/**
 * The next topic with work left in it, for a finished topic's "Next topic"
 * button: the first unfinished topic after this one in syllabus order, else
 * the first unfinished one before it. `undefined` when every topic with
 * questions is solved.
 */
export function nextUnfinishedTopic(
  topics: LearnTopicRow[],
  currentTopicId: string,
): LearnTopicRow | undefined {
  const index = topics.findIndex((topic) => topic.id === currentTopicId);
  const unfinished = (topic: LearnTopicRow) =>
    topic.id !== currentTopicId &&
    topic.total > 0 &&
    topic.solved < topic.total;

  return (
    topics.slice(index + 1).find(unfinished) ??
    topics.slice(0, Math.max(index, 0)).find(unfinished)
  );
}

function mondayOffset(weekday: number) {
  // Sunday = 0. The strip starts on Monday.
  return (weekday + 6) % 7;
}

/** The weekday (Sunday = 0) of a `YYYY-MM-DD` calendar date. */
function weekdayOf(dayIso: string) {
  const [year, month, day] = dayIso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** The calendar date of an instant in the course time zone, as `YYYY-MM-DD`. */
function courseDayKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const parts = Object.fromEntries(
    COURSE_DAY_FORMAT.formatToParts(date).map((part) => [
      part.type,
      part.value,
    ]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** A UTC-midnight date (pure calendar arithmetic) as `YYYY-MM-DD`. */
function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dayIso: string, days: number) {
  const [year, month, day] = dayIso.split("-").map(Number);
  return isoDate(new Date(Date.UTC(year, month - 1, day + days)));
}
