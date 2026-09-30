/**
 * Deterministic seed for the Courses & Sections frontend demo.
 *
 * Everything here is a pure function of the `now` argument: no Math.random, no
 * Date.now, no crypto. The provider renders the same state on the server and on
 * the client, tests can assert exact counts, and "Reset demo data" is literally
 * this function again.
 *
 * The numbers are chosen so the screens have something true to say: a course
 * with two sections that are *almost* the same, a scheduled topic, questions
 * that are approved but not released, one section pinned to an older version,
 * and one release that went stale when its version was unpublished.
 */

import canonicalTopicData from "../../../data/canonical/syllabus-topics.json";
import discreteModelsBatch2Data from "../../../data/demo/discrete-models-batch-2-review-candidates.json";
import followingSyllabusData from "../../../data/demo/following-syllabus-review-candidates.json";
import generatedCandidateData from "../../../data/demo/generated-review-candidates.json";
import demoQuestionData from "../../../data/demo/questions.json";
import nextSyllabusData from "../../../data/demo/next-syllabus-review-candidates.json";
import nextUncoveredSyllabusData from "../../../data/demo/next-uncovered-syllabus-review-candidates.json";
import remediatedSyllabusData from "../../../data/demo/remediated-syllabus-review-candidates.json";
import syllabusCandidateData from "../../../data/demo/syllabus-review-candidates.json";
import { generateJoinCode, hashString } from "@/lib/courses/format";
import {
  DEFAULT_DELIVERY_SETTINGS,
  type AnswerType,
  type BankQuestion,
  type CanonicalTopic,
  type Course,
  type CourseSection,
  type CourseTopic,
  type CoursesState,
  type Difficulty,
  type QuestionLifecycleState,
  type SectionMember,
  type SectionQuestionAvailability,
  type SectionTopicAvailability,
  type TopicId,
} from "@/lib/courses/types";

/** The demo clock. Exported so reducers can fall back to it for `createdAt`. */
export const SEED_NOW = "2026-09-14T15:00:00.000Z";

export const FALL_2026_COURSE_ID = "math-255-fall-2026";
export const SUMMER_2026_COURSE_ID = "math-255-summer-2026";
export const SPRING_2026_COURSE_ID = "math-255-spring-2026";
export const FALL_2025_COURSE_ID = "math-255-fall-2025";

export const FALL_2026_SECTION_01_ID = "sec-f26-01";
export const FALL_2026_SECTION_02_ID = "sec-f26-02";
export const SUMMER_2026_SECTION_ID = "sec-su26-01";
export const SPRING_2026_SECTION_ID = "sec-sp26-01";
export const FALL_2025_SECTION_ID = "sec-f25-01";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

type RawCanonicalTopic = {
  id: string;
  title: string;
  description: string;
  order: number;
  weekNumber: number;
  active: boolean;
};

type RawMisconception = { feedback?: string };

type RawDemoQuestion = {
  id: string;
  topicId: string;
  topic: string;
  title: string;
  difficulty: string;
  questionText: string;
  finalAnswer: string;
  solutionSteps?: string[];
  hints?: string[];
  misconceptions?: RawMisconception[];
};

type RawCandidateAnswer = {
  acceptedAnswers?: string[];
  numericValue?: number;
  spec?: { kind?: string; value?: string; values?: string[] };
};

type RawReviewCandidate = {
  id: string;
  topicId: string;
  topic: string;
  title: string;
  prompt: string;
  patternSource?: string;
  difficulty: string;
  answer?: RawCandidateAnswer;
  hints?: string[];
  solutionSteps?: string[];
  misconceptions?: RawMisconception[];
};

const canonicalTopics = canonicalTopicData as unknown as RawCanonicalTopic[];
const baseQuestions = demoQuestionData as unknown as RawDemoQuestion[];

/**
 * Concatenation order is part of the contract: it decides which candidate fills
 * which slot, so changing it reshuffles every seeded id.
 */
const reviewCandidates = [
  ...(syllabusCandidateData as unknown as RawReviewCandidate[]),
  ...(remediatedSyllabusData as unknown as RawReviewCandidate[]),
  ...(generatedCandidateData as unknown as RawReviewCandidate[]),
  ...(nextSyllabusData as unknown as RawReviewCandidate[]),
  ...(followingSyllabusData as unknown as RawReviewCandidate[]),
  ...(nextUncoveredSyllabusData as unknown as RawReviewCandidate[]),
  ...(discreteModelsBatch2Data as unknown as RawReviewCandidate[]),
];

/**
 * 20-slot lifecycle cycle: 12 published, 3 approved, 3 needs_review, 2 draft.
 * Walking it across the whole bank gives every topic a different-looking mix
 * without any per-topic bookkeeping.
 */
const STATE_CYCLE: QuestionLifecycleState[] = [
  "published",
  "published",
  "approved",
  "published",
  "published",
  "needs_review",
  "published",
  "published",
  "draft",
  "published",
  "approved",
  "published",
  "published",
  "needs_review",
  "published",
  "published",
  "approved",
  "published",
  "needs_review",
  "draft",
];

/** Bank size per topic, 8–14, varied so no two topics look alike. */
function bankTargetForTopic(topicIndex: number) {
  return 8 + ((topicIndex * 3) % 7);
}

function isoAt(nowMs: number, offsetMs: number) {
  return new Date(nowMs + offsetMs).toISOString();
}

/** mulberry32 seeded from a string: stable across runtimes and reloads. */
function createRandom(seed: string) {
  let state = hashString(seed) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * A 64-char hex student key. The real system uses SHA-256, but node:crypto is
 * not available in the browser bundle and this is a demo roster — the only
 * property the UI depends on is "64 stable hex characters, unique per student".
 */
function studentKeyFor(seed: string) {
  const random = createRandom(`student:${seed}`);
  let hex = "";
  while (hex.length < 64) {
    hex += Math.floor(random() * 0x100000000)
      .toString(16)
      .padStart(8, "0");
  }
  return hex.slice(0, 64);
}

const NUMERIC_ANSWER = /^\$?-?\d+(?:\.\d+)?(?:\s*\/\s*-?\d+(?:\.\d+)?)?%?$/;
const EXPRESSION_HINT = /[=<>^]|\\|\b[a-z]\s*\(/i;

/** Numeric when it parses as a number, fraction, or percent; expression when it reads like algebra. */
function inferAnswerType(finalAnswer: string): AnswerType {
  const trimmed = finalAnswer.trim();
  if (NUMERIC_ANSWER.test(trimmed)) {
    return "numeric";
  }
  if (EXPRESSION_HINT.test(trimmed)) {
    return "expression";
  }
  return "categorical";
}

const DIFFICULTY_BY_RAW: Record<string, Difficulty> = {
  foundational: "foundational",
  intermediate: "core",
  core: "core",
  challenge: "challenge",
};

function normalizeDifficulty(raw: string): Difficulty {
  return DIFFICULTY_BY_RAW[raw] ?? "core";
}

function misconceptionText(entries: RawMisconception[] | undefined) {
  return (entries ?? [])
    .map((entry) => entry.feedback ?? "")
    .filter((text): text is string => text.trim().length > 0);
}

/** Human title, or a trimmed prompt when the source has none. */
function humanTitle(title: string | undefined, prompt: string) {
  const trimmed = (title ?? "").trim();
  if (trimmed.length > 0) {
    return trimmed;
  }
  const firstSentence = prompt.trim().split(/(?<=[.?!])\s/)[0] ?? prompt.trim();
  return firstSentence.length > 72
    ? `${firstSentence.slice(0, 69).trimEnd()}…`
    : firstSentence;
}

function candidateFinalAnswer(answer: RawCandidateAnswer | undefined) {
  if (!answer) {
    return "—";
  }
  const accepted = answer.acceptedAnswers?.[0];
  if (accepted && accepted.trim().length > 0) {
    return accepted.trim();
  }
  if (answer.spec?.value) {
    return answer.spec.value;
  }
  if (answer.spec?.values && answer.spec.values.length > 0) {
    return answer.spec.values.join(", ");
  }
  if (typeof answer.numericValue === "number") {
    return String(answer.numericValue);
  }
  return "—";
}

function uniqueTags(values: (string | undefined)[]) {
  const seen = new Set<string>();
  for (const value of values) {
    const tag = (value ?? "").trim().toLowerCase();
    if (tag.length > 0) {
      seen.add(tag);
    }
  }
  return [...seen];
}

/** Ids are used in URLs (`/professor/questions/[qid]`), so refuse anything else. */
const URL_SAFE_ID = /^[A-Za-z0-9:._-]+$/;

type SeedBank = {
  bank: BankQuestion[];
  /** publishedVersion a question had before the seed unpublished it (S6 "held"). */
  formerPublishedVersion: Map<string, number>;
};

function buildBank(topics: CanonicalTopic[], nowMs: number): SeedBank {
  const bank: BankQuestion[] = [];
  const usedIds = new Set<string>();
  let slot = 0;

  topics.forEach((topic, topicIndex) => {
    const target = bankTargetForTopic(topicIndex);
    const sources: { id: string; build: () => BankQuestion }[] = [];

    for (const raw of baseQuestions) {
      if (raw.topicId !== topic.id) {
        continue;
      }
      sources.push({
        id: raw.id,
        build: () => {
          const publishedVersion = 2 + (hashString(raw.id) % 3);
          return {
            id: raw.id,
            topicId: topic.id,
            title: humanTitle(raw.title, raw.questionText),
            prompt: raw.questionText,
            answerType: inferAnswerType(raw.finalAnswer),
            difficulty: normalizeDifficulty(raw.difficulty),
            // The eight hand-written demo questions are the course's spine:
            // they are always published so every screen has live content.
            state: "published",
            publishedVersion,
            latestVersion: publishedVersion,
            finalAnswer: raw.finalAnswer,
            hints: raw.hints ?? [],
            solutionSteps: raw.solutionSteps ?? [],
            misconceptions: misconceptionText(raw.misconceptions),
            tags: uniqueTags([raw.topic]),
            updatedAt: isoAt(nowMs, -(1 + (hashString(raw.id) % 90)) * DAY_MS),
          };
        },
      });
    }

    for (const raw of reviewCandidates) {
      if (raw.topicId !== topic.id) {
        continue;
      }
      sources.push({
        id: raw.id,
        build: () => {
          const finalAnswer = candidateFinalAnswer(raw.answer);
          const state = STATE_CYCLE[slot % STATE_CYCLE.length];
          const publishedVersion =
            state === "published" ? 2 + (hashString(raw.id) % 3) : null;
          const latestVersion =
            publishedVersion ?? 1 + (state === "approved" ? 1 : 0);
          return {
            id: raw.id,
            topicId: topic.id,
            title: humanTitle(raw.title, raw.prompt),
            prompt: raw.prompt,
            answerType: inferAnswerType(finalAnswer),
            difficulty: normalizeDifficulty(raw.difficulty),
            state,
            publishedVersion,
            latestVersion,
            finalAnswer,
            hints: raw.hints ?? [],
            solutionSteps: raw.solutionSteps ?? [],
            misconceptions: misconceptionText(raw.misconceptions),
            tags: uniqueTags([raw.topic, raw.patternSource]),
            updatedAt: isoAt(nowMs, -(1 + (hashString(raw.id) % 90)) * DAY_MS),
          };
        },
      });
    }

    let added = 0;
    for (const source of sources) {
      if (added >= target) {
        break;
      }
      if (usedIds.has(source.id) || !URL_SAFE_ID.test(source.id)) {
        continue;
      }
      usedIds.add(source.id);
      bank.push(source.build());
      added += 1;
      slot += 1;
    }
  });

  // Two questions were published and then pulled back. Their sections keep a
  // stale pin, which is exactly the "held — version unpublished" case on S3/S6.
  const formerPublishedVersion = new Map<string, number>();
  for (const topicIndex of [1, 4]) {
    const topic = topics[topicIndex];
    if (!topic) {
      continue;
    }
    const published = bank.filter(
      (question) =>
        question.topicId === topic.id && question.state === "published",
    );
    const target = published[published.length - 1];
    if (!target || target.publishedVersion === null) {
      continue;
    }
    formerPublishedVersion.set(target.id, target.publishedVersion);
    target.state = "unpublished";
    target.publishedVersion = null;
  }

  return { bank, formerPublishedVersion };
}

type SectionSeed = {
  section: CourseSection;
  memberCount: number;
};

/** Sec 01 holds back 4 of every 25 published questions → ~84% released. */
const SECTION_01_HOLD_BACK = new Set([3, 7, 11, 19]);
/** Sec 02 holds back 5 of every 25 → ~80%, "slightly fewer" than Sec 01. */
const SECTION_02_HOLD_BACK = new Set([2, 6, 10, 14, 18]);

export function createSeedState(now: string = SEED_NOW): CoursesState {
  const nowMs = new Date(now).getTime();

  const topics: CanonicalTopic[] = canonicalTopics
    .filter((topic) => topic.active)
    .sort((left, right) => left.order - right.order)
    .map((topic) => ({
      id: topic.id,
      title: topic.title,
      description: topic.description,
      order: topic.order,
      weekNumber: topic.weekNumber,
      active: topic.active,
    }));

  const { bank, formerPublishedVersion } = buildBank(topics, nowMs);
  const bankById = new Map(bank.map((question) => [question.id, question]));

  const courses: Course[] = [
    {
      id: FALL_2026_COURSE_ID,
      code: "MATH-255",
      title: "Probability & Statistics",
      term: "Fall 2026",
      status: "active",
      createdAt: isoAt(nowMs, -45 * DAY_MS),
    },
    {
      id: SUMMER_2026_COURSE_ID,
      code: "MATH-255",
      title: "Probability & Statistics",
      term: "Summer 2026",
      status: "active",
      createdAt: isoAt(nowMs, -150 * DAY_MS),
    },
    {
      id: SPRING_2026_COURSE_ID,
      code: "MATH-255",
      title: "Probability & Statistics",
      term: "Spring 2026",
      status: "archived",
      createdAt: isoAt(nowMs, -260 * DAY_MS),
    },
    {
      id: FALL_2025_COURSE_ID,
      code: "MATH-255",
      title: "Probability & Statistics",
      term: "Fall 2025",
      status: "archived",
      createdAt: isoAt(nowMs, -400 * DAY_MS),
    },
  ];

  // Every course carries all 11 canonical topics in canonical order. Summer
  // drops the last two so S2/S3 can show the "excluded topic" warning.
  const summerExcluded = new Set<TopicId>(
    topics.slice(-2).map((topic) => topic.id),
  );
  const courseTopics: CourseTopic[] = [];
  for (const course of courses) {
    topics.forEach((topic, position) => {
      courseTopics.push({
        courseId: course.id,
        topicId: topic.id,
        position,
        displayLabel:
          course.id === FALL_2026_COURSE_ID && topic.weekNumber === 3
            ? "Week 3 — Bayes"
            : null,
        included:
          course.id === SUMMER_2026_COURSE_ID
            ? !summerExcluded.has(topic.id)
            : true,
      });
    });
  }

  const usedJoinCodes = new Set<string>(["K7Q-2M", "R4N-8X"]);
  const uniqueJoinCode = (seed: string) => {
    let code = generateJoinCode(seed);
    let attempt = 0;
    while (usedJoinCodes.has(code) && attempt < 50) {
      attempt += 1;
      code = generateJoinCode(`${seed}#${attempt}`);
    }
    usedJoinCodes.add(code);
    return code;
  };

  const sectionSeeds: SectionSeed[] = [
    {
      memberCount: 34,
      section: {
        id: FALL_2026_SECTION_01_ID,
        courseId: FALL_2026_COURSE_ID,
        label: "Section 1",
        meetingTime: "MWF 10:00",
        joinCode: "K7Q-2M",
        status: "active",
        createdAt: isoAt(nowMs, -44 * DAY_MS),
      },
    },
    {
      memberCount: 27,
      section: {
        id: FALL_2026_SECTION_02_ID,
        courseId: FALL_2026_COURSE_ID,
        label: "Section 2",
        meetingTime: "TTh 13:00",
        joinCode: "R4N-8X",
        status: "active",
        createdAt: isoAt(nowMs, -44 * DAY_MS),
      },
    },
    {
      memberCount: 18,
      section: {
        id: SUMMER_2026_SECTION_ID,
        courseId: SUMMER_2026_COURSE_ID,
        label: "Section 1",
        meetingTime: "MTWR 09:00",
        joinCode: uniqueJoinCode(SUMMER_2026_SECTION_ID),
        status: "active",
        createdAt: isoAt(nowMs, -149 * DAY_MS),
      },
    },
    {
      memberCount: 0,
      section: {
        id: SPRING_2026_SECTION_ID,
        courseId: SPRING_2026_COURSE_ID,
        label: "Section 1",
        meetingTime: "MWF 11:00",
        joinCode: uniqueJoinCode(SPRING_2026_SECTION_ID),
        status: "archived",
        createdAt: isoAt(nowMs, -259 * DAY_MS),
      },
    },
    {
      memberCount: 0,
      section: {
        id: FALL_2025_SECTION_ID,
        courseId: FALL_2025_COURSE_ID,
        label: "Section 1",
        meetingTime: "TTh 09:30",
        joinCode: uniqueJoinCode(FALL_2025_SECTION_ID),
        status: "archived",
        createdAt: isoAt(nowMs, -399 * DAY_MS),
      },
    },
  ];
  const sections = sectionSeeds.map((seed) => seed.section);

  // ---- topic availability -------------------------------------------------
  const topicAvailability: SectionTopicAvailability[] = [];
  const pushTopicRows = (
    sectionId: string,
    resolve: (topicIndex: number) => SectionTopicAvailability["state"],
    opensAtByIndex: Record<number, string> = {},
  ) => {
    topics.forEach((topic, topicIndex) => {
      const state = resolve(topicIndex);
      topicAvailability.push({
        sectionId,
        topicId: topic.id,
        state,
        opensAt:
          state === "scheduled" ? (opensAtByIndex[topicIndex] ?? null) : null,
      });
    });
  };

  pushTopicRows(
    FALL_2026_SECTION_01_ID,
    (index) => (index < 6 ? "open" : index === 6 ? "scheduled" : "closed"),
    { 6: isoAt(nowMs, 8 * DAY_MS) },
  );
  pushTopicRows(FALL_2026_SECTION_02_ID, (index) =>
    index < 5 ? "open" : "closed",
  );
  pushTopicRows(SUMMER_2026_SECTION_ID, () => "open");
  pushTopicRows(SPRING_2026_SECTION_ID, () => "closed");
  pushTopicRows(FALL_2025_SECTION_ID, () => "closed");

  const openTopicIdsFor = (sectionId: string) =>
    topicAvailability
      .filter((row) => row.sectionId === sectionId && row.state !== "closed")
      .map((row) => row.topicId);

  // ---- members ------------------------------------------------------------
  const members: SectionMember[] = [];
  for (const seed of sectionSeeds) {
    const openTopicIds = openTopicIdsFor(seed.section.id);
    // 85% of a section has touched the app in the last week — enough for the
    // "29/34 active" line to be interesting without looking fake.
    const activeThisWeek = Math.round(seed.memberCount * 0.85);
    for (let index = 0; index < seed.memberCount; index += 1) {
      const memberSeed = `${seed.section.id}:${index}`;
      const random = createRandom(memberSeed);
      const daysAgo = index < activeThisWeek ? index % 7 : 8 + (index % 6);
      const sessions = 3 + Math.floor(random() * 18);
      const attempts = sessions * (3 + Math.floor(random() * 5));
      const correctAttempts = Math.floor(attempts * (0.45 + random() * 0.45));
      const hintsUsed = Math.floor(attempts * random() * 0.5);
      const topicMastery: Record<TopicId, number> = {};
      for (const topicId of openTopicIds) {
        topicMastery[topicId] = 30 + Math.floor(random() * 66);
      }
      members.push({
        sectionId: seed.section.id,
        studentKey: studentKeyFor(memberSeed),
        joinedAt: isoAt(nowMs, -(20 + (index % 10)) * DAY_MS),
        lastActiveAt: isoAt(
          nowMs,
          -(daysAgo * DAY_MS + ((index * 37) % 23) * HOUR_MS),
        ),
        sessions,
        attempts,
        correctAttempts,
        hintsUsed,
        attentionNote: index % 8 === 3 ? "Week 3: repeated misses" : null,
        topicMastery,
      });
    }
  }

  // ---- question availability ---------------------------------------------
  const questionAvailability: SectionQuestionAvailability[] = [];

  const releaseInto = (
    sectionId: string,
    topicIndexes: number[],
    holdBack: Set<number>,
  ) => {
    const rows: SectionQuestionAvailability[] = [];
    let walked = 0;
    for (const topicIndex of topicIndexes) {
      const topic = topics[topicIndex];
      if (!topic) {
        continue;
      }
      let position = 0;
      for (const question of bank) {
        if (question.topicId !== topic.id || question.state !== "published") {
          continue;
        }
        const skip = holdBack.has(walked % 25);
        walked += 1;
        if (skip) {
          continue;
        }
        rows.push({
          sectionId,
          questionId: question.id,
          state: "released",
          releasedAt: isoAt(
            nowMs,
            -(2 + ((position * 3 + topicIndex * 5) % 40)) * DAY_MS,
          ),
          releasedVersion: question.publishedVersion,
          position,
          delivery: { ...DEFAULT_DELIVERY_SETTINGS },
        });
        position += 1;
      }
    }
    return rows;
  };

  const section01Rows = releaseInto(
    FALL_2026_SECTION_01_ID,
    [0, 1, 2, 3, 4, 5, 6],
    SECTION_01_HOLD_BACK,
  );
  // Two rows carry professor-tuned delivery so S3's expander has real content.
  for (const rowIndex of [2, 11]) {
    const row = section01Rows[rowIndex];
    if (row) {
      row.delivery = {
        ...row.delivery,
        attemptsAllowed: 5,
        hintsEnabled: false,
      };
    }
  }
  questionAvailability.push(...section01Rows);

  // One Sec 01 row is pinned to a version that has since been unpublished.
  const [heldUnpublishedId] = [...formerPublishedVersion.keys()];
  if (heldUnpublishedId) {
    questionAvailability.push({
      sectionId: FALL_2026_SECTION_01_ID,
      questionId: heldUnpublishedId,
      state: "held",
      releasedAt: isoAt(nowMs, -26 * DAY_MS),
      releasedVersion: formerPublishedVersion.get(heldUnpublishedId) ?? 1,
      position: section01Rows.length,
      delivery: { ...DEFAULT_DELIVERY_SETTINGS },
    });
  }

  const section02Rows = releaseInto(
    FALL_2026_SECTION_02_ID,
    [0, 1, 2, 3, 4],
    SECTION_02_HOLD_BACK,
  );
  // Two Sec 02 rows never moved off the previous version: the S6 "older
  // version · [Move to v4]" case.
  let pinnedOlder = 0;
  for (const row of section02Rows) {
    if (pinnedOlder >= 2) {
      break;
    }
    const question = bankById.get(row.questionId);
    if (question?.publishedVersion && question.publishedVersion >= 3) {
      row.releasedVersion = question.publishedVersion - 1;
      pinnedOlder += 1;
    }
  }
  questionAvailability.push(...section02Rows);

  // Summer copies Fall's Sec 01 set, with a handful never re-released.
  section01Rows.forEach((row, index) => {
    questionAvailability.push({
      sectionId: SUMMER_2026_SECTION_ID,
      questionId: row.questionId,
      state: index % 9 === 4 ? "held" : "released",
      releasedAt:
        index % 9 === 4 ? null : isoAt(nowMs, -(120 + (index % 20)) * DAY_MS),
      releasedVersion: row.releasedVersion,
      position: row.position,
      delivery: { ...DEFAULT_DELIVERY_SETTINGS },
    });
  });

  // Archived terms keep a short history so the clone flow has something to copy.
  const archivedRows = (
    sectionId: string,
    count: number,
    offsetDays: number,
  ) => {
    const published = bank.filter((question) => question.state === "published");
    published.slice(0, count).forEach((question, index) => {
      questionAvailability.push({
        sectionId,
        questionId: question.id,
        state: "released",
        releasedAt: isoAt(nowMs, -(offsetDays + index) * DAY_MS),
        releasedVersion: question.publishedVersion,
        position: index,
        delivery: { ...DEFAULT_DELIVERY_SETTINGS },
      });
    });
  };
  archivedRows(SPRING_2026_SECTION_ID, 6, 200);
  archivedRows(FALL_2025_SECTION_ID, 4, 340);

  // ---- pinned sessions ----------------------------------------------------
  // Students mid-attempt on a released version. Removing one of these is what
  // triggers the S7 warning, so they sit on rows a professor is likely to touch.
  const pinnedSessions: Record<string, number> = {};
  const pinnedTargets = [
    ...section01Rows.filter((_, index) => index % 7 === 1).slice(0, 4),
    ...section02Rows.filter((_, index) => index % 5 === 2).slice(0, 2),
  ];
  for (const row of pinnedTargets) {
    const key = `${row.sectionId}:${row.questionId}`;
    pinnedSessions[key] = 1 + (hashString(key) % 9);
  }

  return {
    schemaVersion: 1,
    activeCourseId: FALL_2026_COURSE_ID,
    topics,
    bank,
    courses,
    courseTopics,
    sections,
    members,
    topicAvailability,
    questionAvailability,
    pinnedSessions,
  };
}
