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
  description: string;
  glyph: TopicGlyph;
  href: string;
  id: string;
  /** 1-based position in canonical syllabus order — rendered as "01". */
  index: number;
  isCurrent: boolean;
  /** "no questions yet" for a topic with nothing published. */
  meta?: string;
  solved: number;
  title: string;
  total: number;
  weekNumber: number;
};

export type ContinueCard = {
  detail?: string;
  eyebrow?: string;
  kind: "resume" | "start" | "empty";
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
  doneLabel: string;
  extraPracticeHref: string;
  questionCountLabel: string;
  weekLabel: string;
};

export type TopicModel = {
  about: TopicAbout;
  description: string;
  id: string;
  isGuest: boolean;
  questions: LearnQuestionRow[];
  title: string;
  weekLabel: string;
  weekNumber: number;
};

export type LearnModelInput = {
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

/** "Wk 3" — the mono week label used as an eyebrow everywhere. */
export function weekLabel(weekNumber: number) {
  return `Wk ${weekNumber}`;
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

/** The UTC Monday of the week containing `nowIso`, as a `YYYY-MM-DD` date. */
export function weekStartIsoFor(nowIso: string) {
  const now = new Date(nowIso);
  const start = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - mondayOffset(now.getUTCDay()),
  );
  return dayKey(new Date(start));
}

/**
 * Relative time, resolved on the server so the string that reaches the browser
 * is already a string. Deliberately coarse: a student needs "2h ago", never
 * "2 hours and 14 minutes ago".
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
    return `${Math.floor(elapsed / MINUTE)}m ago`;
  }
  if (elapsed < DAY) {
    return `${Math.floor(elapsed / HOUR)}h ago`;
  }
  if (elapsed < 7 * DAY) {
    return `${Math.floor(elapsed / DAY)}d ago`;
  }

  const date = new Date(then);
  return `on ${SHORT_MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

export function buildLearnModel(input: LearnModelInput): LearnModel {
  const { nowIso, progress, questions, topics } = input;
  const rows = buildQuestionRows(questions, progress);
  const topicRows = buildTopicRows(topics, rows);
  const currentTopicId = pickCurrentTopicId(topicRows, rows, progress);

  return {
    continueCard: buildContinueCard({ nowIso, progress, rows, topics }),
    glance: buildGlance({ nowIso, progress, rows }),
    isGuest: progress === null,
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
  nowIso: string;
  progress: StudentProgressDashboard | null;
  questions: StudentPracticeQuestion[];
  topic: CourseTopic;
}): TopicModel {
  const { progress, questions, topic } = input;
  const rows = buildQuestionRows(questions, progress).filter(
    (question) => question.topicId === topic.id,
  );
  const done = rows.filter((question) => question.status === "done").length;
  const hintsUsed = rows.reduce(
    (total, question) => total + question.hintsUsed,
    0,
  );
  const touched = rows.filter(
    (question) => question.attemptCount > 0 || question.hintsUsed > 0,
  ).length;

  return {
    about: {
      doneLabel:
        touched > 0
          ? `${done} done · ${formatAverage(hintsUsed / touched)} hint avg`
          : `${done} done`,
      extraPracticeHref: `/practice?topicId=${encodeURIComponent(topic.id)}`,
      questionCountLabel:
        rows.length === 1 ? "1 question" : `${rows.length} questions`,
      weekLabel: weekLabel(topic.weekNumber),
    },
    description: topic.description,
    id: topic.id,
    isGuest: progress === null,
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
): LearnTopicRow[] {
  return topics.map((topic, index) => {
    const own = rows.filter((question) => question.topicId === topic.id);
    const solved = own.filter((question) => question.status === "done").length;
    const started = own.some((question) => question.status === "current");
    const total = own.length;

    return {
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
 * "You are here": the topic the student is actually inside, which is the topic
 * of whatever they would resume. With nothing in progress it falls back to the
 * first topic that still has work in it — the same place "Start here" points.
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

    return {
      detail: [
        resume.questionCode,
        hintsUsedLabel(resume.hintsUsed),
        lastSeen ? `last opened ${relativeTimeLabel(lastSeen, nowIso)}` : "",
      ]
        .filter((part) => part.length > 0)
        .join(" · "),
      eyebrow: topic
        ? `${weekLabel(topic.weekNumber)} · ${topic.title}`
        : undefined,
      kind: "resume",
      primary: { href: resume.href, label: "Resume →" },
      questionTitle: resume.title,
      secondary: firstTodo
        ? { href: firstTodo.href, label: "Next new" }
        : undefined,
    };
  }

  const start = firstTodo ?? rows[0];

  if (!start) {
    return {
      kind: "empty",
      message:
        "No practice questions are available yet. Your professor adds them as they are reviewed.",
    };
  }

  const topic = topicsById.get(start.topicId);

  return {
    detail: [
      start.questionCode,
      start.difficultyLabel,
      hintsAvailableLabel(start.hintCount),
    ]
      .filter((part) => part.length > 0)
      .join(" · "),
    eyebrow: topic
      ? `${weekLabel(topic.weekNumber)} · ${topic.title}`
      : undefined,
    kind: "start",
    message: "Start here",
    primary: { href: start.href, label: "Start here →" },
    questionTitle: start.title,
  };
}

export function buildWeekStrip(input: {
  nowIso: string;
  progress: StudentProgressDashboard | null;
}): WeekStrip {
  const { nowIso, progress } = input;
  const weekStart = weekStartIsoFor(nowIso);
  const todayKey = dayKey(new Date(nowIso));
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
    const key = (question.completedAt ?? question.lastActiveAt).slice(0, 10);
    return key >= weekStart && key < weekEnd;
  });
  const firstTry = completed.filter(
    (question) => question.attemptCount === 1,
  ).length;
  const firstTryLabel =
    completed.length > 0
      ? `${Math.round((firstTry / completed.length) * 100)}% first-try`
      : "— first-try";

  return {
    completedThisWeek: completed.length,
    days,
    firstTryLabel,
    summary: `${completed.length} ${
      completed.length === 1 ? "problem" : "problems"
    } · ${firstTryLabel}`,
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

  return { active, retired };
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
  const now = new Date(nowIso);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const dayCount = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return {
    days: Array.from({ length: dayCount }, (_, index) => {
      const day = index + 1;
      return {
        active: activeDays.has(dayKey(new Date(Date.UTC(year, month, day)))),
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
    keys.add(session.lastSeenAt.slice(0, 10));
  }
  for (const question of progress?.questions ?? []) {
    keys.add(question.lastActiveAt.slice(0, 10));
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

function formatAverage(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return (Math.round(value * 10) / 10).toString();
}

function mondayOffset(utcDay: number) {
  // getUTCDay(): Sunday = 0. The strip starts on Monday.
  return (utcDay + 6) % 7;
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dayIso: string, days: number) {
  const [year, month, day] = dayIso.split("-").map(Number);
  return dayKey(new Date(Date.UTC(year, month - 1, day + days)));
}
