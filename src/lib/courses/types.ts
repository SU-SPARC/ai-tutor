/**
 * Courses, sections, and per-section release of question versions.
 *
 * This is the frontend-demo domain model for the "Courses, Sections, and
 * Professor-Authored Topic Questions" blueprint. It mirrors the proposed
 * tables (courses, course_topics, course_sections, section_members,
 * section_topic_availability, section_question_availability) closely enough
 * that a later API can serialize straight into it. Nothing here touches the
 * immutable question versions: a course only *overlays* the canonical topic
 * list, and a section only *pins* an already-published version.
 */

export type CourseId = string;
export type SectionId = string;
export type TopicId = string;
export type QuestionId = string;
/** SHA-256 hex student key. Instructor surfaces never see names or emails. */
export type StudentKey = string;

export type QuestionLifecycleState =
  | "draft"
  | "needs_review"
  | "approved"
  | "published"
  | "unpublished";

export type AnswerType = "numeric" | "categorical" | "expression";
export type Difficulty = "foundational" | "core" | "challenge";

/** One canonical syllabus topic, as loaded from data/canonical/syllabus-topics.json. */
export type CanonicalTopic = {
  id: TopicId;
  title: string;
  description: string;
  order: number;
  weekNumber: number;
  active: boolean;
};

/** A question in the shared bank as the course tools see it. */
export type BankQuestion = {
  id: QuestionId;
  topicId: TopicId;
  title: string;
  prompt: string;
  answerType: AnswerType;
  difficulty: Difficulty;
  state: QuestionLifecycleState;
  /** The version students can be pointed at; null until first publish. */
  publishedVersion: number | null;
  /** Highest version number that exists (working version). */
  latestVersion: number;
  finalAnswer: string;
  hints: string[];
  solutionSteps: string[];
  misconceptions: string[];
  tags: string[];
  updatedAt: string;
};

export type CourseStatus = "active" | "archived";

export type Course = {
  id: CourseId;
  /** Registrar code, e.g. "MATH-255". */
  code: string;
  title: string;
  /** e.g. "Fall 2026". */
  term: string;
  status: CourseStatus;
  createdAt: string;
};

/** Overlay row: which canonical topics this course includes, in what order. */
export type CourseTopic = {
  courseId: CourseId;
  topicId: TopicId;
  position: number;
  /** Optional professor label ("Week 3 — Bayes"); canonical title is always kept. */
  displayLabel: string | null;
  included: boolean;
};

export type SectionStatus = "active" | "archived";

export type CourseSection = {
  id: SectionId;
  courseId: CourseId;
  /** Short label, e.g. "Section 1". */
  label: string;
  /** e.g. "MWF 10:00". */
  meetingTime: string;
  /** e.g. "K7Q-2M". */
  joinCode: string;
  status: SectionStatus;
  createdAt: string;
};

export type SectionMember = {
  sectionId: SectionId;
  studentKey: StudentKey;
  joinedAt: string;
  lastActiveAt: string;
  sessions: number;
  attempts: number;
  correctAttempts: number;
  hintsUsed: number;
  /** Set when the analytics rules flag repeated difficulty. */
  attentionNote: string | null;
  /** 0–100 per topic the student has touched. */
  topicMastery: Record<TopicId, number>;
};

export type TopicAvailabilityState = "open" | "closed" | "scheduled";

export type SectionTopicAvailability = {
  sectionId: SectionId;
  topicId: TopicId;
  state: TopicAvailabilityState;
  /** ISO timestamp, only meaningful when state is "scheduled". */
  opensAt: string | null;
};

export type SolutionRevealPolicy =
  | "never"
  | "after_2_wrong"
  | "after_3_wrong"
  | "after_correct";

/** Section-scoped delivery settings. Never stored on the question itself. */
export type DeliverySettings = {
  attemptsAllowed: number;
  hintsEnabled: boolean;
  solutionReveal: SolutionRevealPolicy;
};

export type QuestionReleaseState = "released" | "held";

export type SectionQuestionAvailability = {
  sectionId: SectionId;
  questionId: QuestionId;
  state: QuestionReleaseState;
  releasedAt: string | null;
  /** Which published version this section is pinned to. */
  releasedVersion: number | null;
  /** Order within its topic on the section's released list. */
  position: number;
  delivery: DeliverySettings;
};

/**
 * Whole demo state. Persisted to localStorage by the client store and
 * re-seeded deterministically on reset.
 */
export type CoursesState = {
  schemaVersion: 1;
  /** Which course the professor tools are currently scoped to. */
  activeCourseId: CourseId | null;
  topics: CanonicalTopic[];
  bank: BankQuestion[];
  courses: Course[];
  courseTopics: CourseTopic[];
  sections: CourseSection[];
  members: SectionMember[];
  topicAvailability: SectionTopicAvailability[];
  questionAvailability: SectionQuestionAvailability[];
  /**
   * Open student sessions pinned to a released version, keyed
   * `${sectionId}:${questionId}`. Drives the S7 removal warning.
   */
  pinnedSessions: Record<string, number>;
};

/** One staged add/remove on the S3 builder before "Review N changes". */
export type StagedReleaseChange =
  | { kind: "add"; questionId: QuestionId }
  | { kind: "remove"; questionId: QuestionId };

export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = {
  attemptsAllowed: 3,
  hintsEnabled: true,
  solutionReveal: "after_2_wrong",
};

export const COURSES_STORAGE_KEY = "ai-tutor-courses-demo-v1";
