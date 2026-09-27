/**
 * Read models for the Courses & Sections screens.
 *
 * Every function here is a pure function of `CoursesState`, small enough to
 * read in one screenful, and named after the thing on screen rather than the
 * table it reads. The distinction the whole feature turns on is encoded here:
 * *approved* is not *published*, and *published* is not *released to my
 * Tuesday section*.
 */

import { topicShortLabel } from "@/lib/courses/format";
import { SEED_NOW } from "@/lib/courses/demo-seed";
import type {
  BankQuestion,
  CanonicalTopic,
  Course,
  CourseId,
  CourseSection,
  CourseTopic,
  CoursesState,
  QuestionId,
  QuestionLifecycleState,
  SectionId,
  SectionMember,
  SectionQuestionAvailability,
  SectionTopicAvailability,
  StagedReleaseChange,
  TopicId,
} from "@/lib/courses/types";

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Return shapes (exported so screens can type their props without re-deriving)
// ---------------------------------------------------------------------------

/** One row of the syllabus overlay: canonical topic plus this course's opinion. */
export type CourseTopicView = {
  topic: CanonicalTopic;
  overlay: CourseTopic;
  label: string;
};

export type CourseSummary = {
  sectionCount: number;
  studentCount: number;
  topicCount: number;
  /** Distinct questions released to at least one section of this course. */
  releasedCount: number;
  /** Approved but never published — publishing is the missing gate. */
  approvedNotPublished: number;
  /** Published but not released to any section — releasing is the missing gate. */
  publishedNotReleased: number;
  /** Both of the above, the "N waiting to release" line on the S1 card. */
  approvedNotReleased: number;
  needsReview: number;
};

export type CoursePipelineSection = {
  sectionId: SectionId;
  label: string;
  count: number;
};

export type CoursePipeline = {
  draft: number;
  needsReview: number;
  approved: number;
  published: number;
  releasedBySection: CoursePipelineSection[];
};

export type SectionSummary = {
  joined: number;
  topicsOpen: number;
  topicsTotal: number;
  released: number;
  lastActivityAt: string | null;
};

/**
 * A released row, flattened for rendering.
 *
 * `BankQuestion & SectionQuestionAvailability` collapses to `never` on `state`
 * (lifecycle vs release), so `state` here is the *release* state and the
 * lifecycle state is carried as `lifecycleState`.
 */
export type ReleasedQuestion = Omit<BankQuestion, "state"> &
  SectionQuestionAvailability & {
    lifecycleState: QuestionLifecycleState;
  };

export type SectionBuilderTopic = {
  topic: CanonicalTopic;
  label: string;
  availability: SectionTopicAvailability;
  released: ReleasedQuestion[];
  bank: BankQuestion[];
  releasedCount: number;
  bankCount: number;
};

export type ReleaseBlockReason =
  | "Approved — publish first"
  | "Needs review"
  | "Draft"
  | "Unpublished — republish first";

export type ReleaseChangeReady = {
  kind: "add" | "remove";
  question: BankQuestion;
  /** Version this section will be pinned to; null for removals. */
  version: number | null;
};

export type ReleaseChangeBlocked = {
  kind: "add" | "remove";
  question: BankQuestion;
  reason: string;
};

export type ReleaseChangeWarning = {
  question: BankQuestion;
  pinnedSessions: number;
};

export type ReleaseChangePreview = {
  ready: ReleaseChangeReady[];
  blocked: ReleaseChangeBlocked[];
  warnings: ReleaseChangeWarning[];
};

export type QuestionReleaseStatus = "live" | "older" | "held" | "not_released";

export type QuestionReleaseSectionRow = {
  sectionId: SectionId;
  label: string;
  meetingTime: string;
  releasedVersion: number | null;
  publishedVersion: number | null;
  status: QuestionReleaseStatus;
};

export type QuestionReleaseCourseGroup = {
  course: Course;
  sections: QuestionReleaseSectionRow[];
};

export type QuestionReleasedSection = {
  course: Course | undefined;
  section: CourseSection;
  availability: SectionQuestionAvailability;
};

export type SectionTopicMastery = {
  topicId: TopicId;
  label: string;
  pct: number;
};

export type SectionProgress = {
  /** Correct attempts over all attempts, as a whole percent. */
  classCorrectness: number;
  activeThisWeek: number;
  activeTotal: number;
  needsAttention: number;
  topicMastery: SectionTopicMastery[];
};

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/** Bank order on S3/S4: what can go out now, then what needs a decision. */
const LIFECYCLE_RANK: Record<QuestionLifecycleState, number> = {
  published: 0,
  approved: 1,
  needs_review: 2,
  draft: 3,
  unpublished: 4,
};

function compareBankQuestions(left: BankQuestion, right: BankQuestion) {
  return (
    LIFECYCLE_RANK[left.state] - LIFECYCLE_RANK[right.state] ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
}

function topicById(state: CoursesState) {
  return new Map(state.topics.map((topic) => [topic.id, topic]));
}

function bankById(state: CoursesState) {
  return new Map(state.bank.map((question) => [question.id, question]));
}

function overlayLabel(topic: CanonicalTopic, overlay: CourseTopic) {
  return overlay.displayLabel ?? topicShortLabel(topic, 60);
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

export function getCourse(
  state: CoursesState,
  id: CourseId,
): Course | undefined {
  return state.courses.find((course) => course.id === id);
}

/** Active courses first, newest first inside each group — S1's reading order. */
export function listCourses(state: CoursesState): Course[] {
  return [...state.courses].sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === "active" ? -1 : 1;
    }
    return (
      right.createdAt.localeCompare(left.createdAt) ||
      left.id.localeCompare(right.id)
    );
  });
}

export function getSection(
  state: CoursesState,
  id: SectionId,
): CourseSection | undefined {
  return state.sections.find((section) => section.id === id);
}

export function listSections(
  state: CoursesState,
  courseId: CourseId,
): CourseSection[] {
  return state.sections
    .filter((section) => section.courseId === courseId)
    .sort(
      (left, right) =>
        left.label.localeCompare(right.label) ||
        left.id.localeCompare(right.id),
    );
}

/**
 * The syllabus overlay in display order: included topics by position, then the
 * excluded ones so the ⚠ "dropped from this course" row stays visible.
 */
export function courseTopicsOrdered(
  state: CoursesState,
  courseId: CourseId,
): CourseTopicView[] {
  const topics = topicById(state);
  return state.courseTopics
    .filter((overlay) => overlay.courseId === courseId)
    .flatMap((overlay) => {
      const topic = topics.get(overlay.topicId);
      return topic
        ? [{ topic, overlay, label: overlayLabel(topic, overlay) }]
        : [];
    })
    .sort((left, right) => {
      if (left.overlay.included !== right.overlay.included) {
        return left.overlay.included ? -1 : 1;
      }
      return left.overlay.position - right.overlay.position;
    });
}

function includedTopicIds(state: CoursesState, courseId: CourseId) {
  return new Set(
    state.courseTopics
      .filter((overlay) => overlay.courseId === courseId && overlay.included)
      .map((overlay) => overlay.topicId),
  );
}

function sectionIdsFor(state: CoursesState, courseId: CourseId) {
  return new Set(
    state.sections
      .filter((section) => section.courseId === courseId)
      .map((section) => section.id),
  );
}

/** Question ids released (not held) to any section of this course. */
function releasedQuestionIds(state: CoursesState, courseId: CourseId) {
  const sectionIds = sectionIdsFor(state, courseId);
  const ids = new Set<QuestionId>();
  for (const row of state.questionAvailability) {
    if (row.state === "released" && sectionIds.has(row.sectionId)) {
      ids.add(row.questionId);
    }
  }
  return ids;
}

/** The facts on an S1 card, in the order the card reads them. */
export function courseSummary(
  state: CoursesState,
  courseId: CourseId,
): CourseSummary {
  const sectionIds = sectionIdsFor(state, courseId);
  const included = includedTopicIds(state, courseId);
  const released = releasedQuestionIds(state, courseId);

  let approvedNotPublished = 0;
  let publishedNotReleased = 0;
  let needsReview = 0;
  for (const question of state.bank) {
    if (!included.has(question.topicId)) {
      continue;
    }
    if (question.state === "approved") {
      approvedNotPublished += 1;
    } else if (question.state === "published" && !released.has(question.id)) {
      publishedNotReleased += 1;
    } else if (question.state === "needs_review") {
      needsReview += 1;
    }
  }

  return {
    sectionCount: sectionIds.size,
    studentCount: state.members.filter((member) =>
      sectionIds.has(member.sectionId),
    ).length,
    topicCount: included.size,
    releasedCount: released.size,
    approvedNotPublished,
    publishedNotReleased,
    approvedNotReleased: approvedNotPublished + publishedNotReleased,
    needsReview,
  };
}

/** The S2 pipeline strip: four lifecycle stages plus the per-section gate. */
export function coursePipeline(
  state: CoursesState,
  courseId: CourseId,
): CoursePipeline {
  const included = includedTopicIds(state, courseId);
  const counts = { draft: 0, needsReview: 0, approved: 0, published: 0 };
  for (const question of state.bank) {
    if (!included.has(question.topicId)) {
      continue;
    }
    if (question.state === "draft") {
      counts.draft += 1;
    } else if (question.state === "needs_review") {
      counts.needsReview += 1;
    } else if (question.state === "approved") {
      counts.approved += 1;
    } else if (question.state === "published") {
      counts.published += 1;
    }
  }

  const releasedBySection = listSections(state, courseId)
    .filter((section) => section.status === "active")
    .map((section) => ({
      sectionId: section.id,
      label: section.label,
      count: state.questionAvailability.filter(
        (row) => row.sectionId === section.id && row.state === "released",
      ).length,
    }));

  return { ...counts, releasedBySection };
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export function sectionSummary(
  state: CoursesState,
  sectionId: SectionId,
): SectionSummary {
  const section = getSection(state, sectionId);
  const included = section
    ? includedTopicIds(state, section.courseId)
    : new Set<TopicId>();
  const members = sectionMembers(state, sectionId);
  const lastActivityAt = members.reduce<string | null>(
    (latest, member) =>
      latest === null || member.lastActiveAt > latest
        ? member.lastActiveAt
        : latest,
    null,
  );

  return {
    joined: members.length,
    topicsOpen: state.topicAvailability.filter(
      (row) =>
        row.sectionId === sectionId &&
        row.state === "open" &&
        included.has(row.topicId),
    ).length,
    topicsTotal: included.size,
    released: state.questionAvailability.filter(
      (row) => row.sectionId === sectionId && row.state === "released",
    ).length,
    lastActivityAt,
  };
}

/**
 * The S3 builder, one entry per included topic in the course's overlay order so
 * the released pane and the bank pane always agree about ordering.
 */
export function sectionBuilder(
  state: CoursesState,
  sectionId: SectionId,
): SectionBuilderTopic[] {
  const section = getSection(state, sectionId);
  if (!section) {
    return [];
  }
  const rowsByQuestion = new Map(
    state.questionAvailability
      .filter((row) => row.sectionId === sectionId)
      .map((row) => [row.questionId, row]),
  );

  return courseTopicsOrdered(state, section.courseId)
    .filter((entry) => entry.overlay.included)
    .map(({ topic, label }) => {
      const availability = state.topicAvailability.find(
        (row) => row.sectionId === sectionId && row.topicId === topic.id,
      ) ?? {
        sectionId,
        topicId: topic.id,
        state: "closed" as const,
        opensAt: null,
      };

      const released: ReleasedQuestion[] = [];
      const bank: BankQuestion[] = [];
      for (const question of state.bank) {
        if (question.topicId !== topic.id) {
          continue;
        }
        bank.push(question);
        const row = rowsByQuestion.get(question.id);
        if (row && row.state === "released") {
          const { state: lifecycleState, ...rest } = question;
          released.push({ ...rest, ...row, lifecycleState });
        }
      }
      released.sort(
        (left, right) =>
          left.position - right.position || left.id.localeCompare(right.id),
      );
      bank.sort(compareBankQuestions);

      return {
        topic,
        label,
        availability,
        released,
        bank,
        releasedCount: released.length,
        bankCount: bank.length,
      };
    });
}

export function sectionMembers(
  state: CoursesState,
  sectionId: SectionId,
): SectionMember[] {
  return state.members
    .filter((member) => member.sectionId === sectionId)
    .sort((left, right) => right.lastActiveAt.localeCompare(left.lastActiveAt));
}

/**
 * S5's three tiles plus the mastery bars. `now` is a parameter so the numbers
 * are identical on the server, on the client, and in a test.
 */
export function sectionProgress(
  state: CoursesState,
  sectionId: SectionId,
  now: string = SEED_NOW,
): SectionProgress {
  const members = sectionMembers(state, sectionId);
  const reference = new Date(now).getTime();
  const section = getSection(state, sectionId);

  let attempts = 0;
  let correctAttempts = 0;
  let activeThisWeek = 0;
  let needsAttention = 0;
  for (const member of members) {
    attempts += member.attempts;
    correctAttempts += member.correctAttempts;
    if (reference - new Date(member.lastActiveAt).getTime() <= 7 * DAY_MS) {
      activeThisWeek += 1;
    }
    if (member.attentionNote) {
      needsAttention += 1;
    }
  }

  // Mastery is only meaningful where students can reach the topic, so closed
  // topics are left off the chart entirely rather than shown as 0%.
  const openTopicIds = new Set(
    state.topicAvailability
      .filter((row) => row.sectionId === sectionId && row.state !== "closed")
      .map((row) => row.topicId),
  );
  const overlayOrder = section
    ? courseTopicsOrdered(state, section.courseId).filter(
        (entry) => entry.overlay.included && openTopicIds.has(entry.topic.id),
      )
    : [];

  const topicMastery = overlayOrder.map(({ topic, label }) => {
    const scores = members
      .map((member) => member.topicMastery[topic.id])
      .filter((score): score is number => typeof score === "number");
    const pct =
      scores.length === 0
        ? 0
        : Math.round(
            scores.reduce((sum, score) => sum + score, 0) / scores.length,
          );
    return { topicId: topic.id, label, pct };
  });

  return {
    classCorrectness:
      attempts === 0 ? 0 : Math.round((correctAttempts / attempts) * 100),
    activeThisWeek,
    activeTotal: members.length,
    needsAttention,
    topicMastery,
  };
}

// ---------------------------------------------------------------------------
// Release gates
// ---------------------------------------------------------------------------

/** Why the ⊕ is disabled, in the words the modal and the row both use. */
export function releaseBlockReason(
  question: BankQuestion,
): ReleaseBlockReason | null {
  switch (question.state) {
    case "published":
      return null;
    case "approved":
      return "Approved — publish first";
    case "needs_review":
      return "Needs review";
    case "draft":
      return "Draft";
    case "unpublished":
      return "Unpublished — republish first";
    default:
      return null;
  }
}

/**
 * S7's preflight: every staged change, sorted into what will apply, what is
 * blocked, and what will surprise a student who is mid-attempt.
 */
export function previewReleaseChanges(
  state: CoursesState,
  sectionId: SectionId,
  changes: StagedReleaseChange[],
): ReleaseChangePreview {
  const preview: ReleaseChangePreview = {
    ready: [],
    blocked: [],
    warnings: [],
  };
  const questions = bankById(state);
  const releasedIds = new Set(
    state.questionAvailability
      .filter((row) => row.sectionId === sectionId)
      .map((row) => row.questionId),
  );

  for (const change of changes) {
    const question = questions.get(change.questionId);
    // An id that is not in the bank cannot be described to the professor, so it
    // is dropped rather than shown as a mystery row.
    if (!question) {
      continue;
    }

    if (change.kind === "add") {
      const reason = releaseBlockReason(question);
      if (reason) {
        preview.blocked.push({ kind: "add", question, reason });
      } else {
        preview.ready.push({
          kind: "add",
          question,
          version: question.publishedVersion,
        });
      }
      continue;
    }

    if (!releasedIds.has(question.id)) {
      preview.blocked.push({
        kind: "remove",
        question,
        reason: "Not released to this section",
      });
      continue;
    }
    preview.ready.push({ kind: "remove", question, version: null });
    const pinned = state.pinnedSessions[`${sectionId}:${question.id}`] ?? 0;
    if (pinned > 0) {
      preview.warnings.push({ question, pinnedSessions: pinned });
    }
  }

  return preview;
}

/**
 * "Copy to ▾": the staged changes that would make `toSectionId` match
 * `fromSectionId`. Both directions are produced — adds for what is missing and
 * removes for what the target has extra — so the review modal shows the whole
 * consequence before anything is written.
 */
export function copyReleasedSetChanges(
  state: CoursesState,
  fromSectionId: SectionId,
  toSectionId: SectionId,
): StagedReleaseChange[] {
  if (fromSectionId === toSectionId) {
    return [];
  }
  const releasedIn = (sectionId: SectionId) =>
    new Set(
      state.questionAvailability
        .filter(
          (row) => row.sectionId === sectionId && row.state === "released",
        )
        .map((row) => row.questionId),
    );
  const source = releasedIn(fromSectionId);
  const target = releasedIn(toSectionId);

  const changes: StagedReleaseChange[] = [];
  for (const questionId of source) {
    if (!target.has(questionId)) {
      changes.push({ kind: "add", questionId });
    }
  }
  for (const questionId of target) {
    if (!source.has(questionId)) {
      changes.push({ kind: "remove", questionId });
    }
  }
  return changes;
}

/**
 * The S6 rail: where one question stands in every course, active terms first so
 * the professor sees the live answer before the history.
 */
export function questionReleaseMap(
  state: CoursesState,
  questionId: QuestionId,
): QuestionReleaseCourseGroup[] {
  const question = state.bank.find((candidate) => candidate.id === questionId);
  const publishedVersion = question?.publishedVersion ?? null;

  return listCourses(state).map((course) => ({
    course,
    sections: listSections(state, course.id).map((section) => {
      const row = state.questionAvailability.find(
        (candidate) =>
          candidate.sectionId === section.id &&
          candidate.questionId === questionId,
      );
      let status: QuestionReleaseStatus = "not_released";
      if (row?.state === "held") {
        status = "held";
      } else if (row?.state === "released") {
        if (
          publishedVersion !== null &&
          row.releasedVersion !== null &&
          row.releasedVersion < publishedVersion
        ) {
          status = "older";
        } else if (
          publishedVersion !== null &&
          row.releasedVersion === publishedVersion
        ) {
          status = "live";
        } else {
          // Released against a version that is no longer the published one
          // (typically unpublished): the section is holding stale content.
          status = "held";
        }
      }
      return {
        sectionId: section.id,
        label: section.label,
        meetingTime: section.meetingTime,
        releasedVersion: row?.releasedVersion ?? null,
        publishedVersion,
        status,
      };
    }),
  }));
}

// ---------------------------------------------------------------------------
// Question-centric lookups (S4)
// ---------------------------------------------------------------------------

export function bankQuestionsForTopic(
  state: CoursesState,
  topicId: TopicId,
): BankQuestion[] {
  return state.bank
    .filter((question) => question.topicId === topicId)
    .sort(compareBankQuestions);
}

/** S4's "Released to" column: which sections currently show this question. */
export function questionReleasedSections(
  state: CoursesState,
  questionId: QuestionId,
): QuestionReleasedSection[] {
  return state.questionAvailability
    .filter((row) => row.questionId === questionId && row.state === "released")
    .flatMap((availability) => {
      const section = getSection(state, availability.sectionId);
      if (!section) {
        return [];
      }
      return [
        { course: getCourse(state, section.courseId), section, availability },
      ];
    })
    .sort(
      (left, right) =>
        left.section.courseId.localeCompare(right.section.courseId) ||
        left.section.label.localeCompare(right.section.label),
    );
}
