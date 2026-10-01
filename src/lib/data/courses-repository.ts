import "server-only";

import { createHash, randomInt } from "node:crypto";

import type { StudentOwner } from "@/lib/auth/principal";
import { createSeedState } from "@/lib/courses/demo-seed";
import { formatJoinCode } from "@/lib/courses/format";
import { isCourseEntityId } from "@/lib/courses/paths";
import { coursesReducer, type CoursesAction } from "@/lib/courses/reducer";
import {
  DEFAULT_DELIVERY_SETTINGS,
  type AnswerType,
  type BankQuestion,
  type CanonicalTopic,
  type Course,
  type CourseSection,
  type CourseTopic,
  type CoursesState,
  type DeliverySettings,
  type Difficulty,
  type QuestionLifecycleState,
  type SectionMember,
  type SectionQuestionAvailability,
  type SectionTopicAvailability,
  type SolutionRevealPolicy,
  type TopicAvailabilityState,
} from "@/lib/courses/types";
import { ANALYTICS_STUDENT_SESSION_FILTER_SQL } from "@/lib/data/analytics-population";
import {
  readDatabaseRows,
  runDatabaseTransaction,
  type DatabaseQueryExecutor,
  type DatabaseQueryValue,
} from "@/lib/data/database-executor";
import { mapQuestionRow } from "@/lib/data/database-repository";
import { VALID_ANSWER_ATTEMPT_SQL } from "@/lib/tutor/practice-credit";
import type { TutorQuestion } from "@/lib/types";

export type StudentSectionDto = {
  sectionId: string;
  sectionLabel: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  term: string;
  joinedAt: string;
};

export type SectionReleaseDto = {
  questionId: string;
  questionVersionId: number;
  releasedVersion: number;
  position: number;
  topicId: string;
  topicPosition: number;
  topicState: "open" | "closed" | "scheduled";
  opensAt?: string;
  delivery: DeliverySettings;
};

/** Unknown course, section, or join code (or one the caller does not own). */
export class CoursesNotFoundError extends Error {
  constructor(message = "That course or section was not found.") {
    super(message);
    this.name = "CoursesNotFoundError";
  }
}

/** The reducer rejected the action, the action is unsupported, or bad input. */
export class CoursesValidationError extends Error {
  constructor(message = "That change is not allowed.") {
    super(message);
    this.name = "CoursesValidationError";
  }
}

/** A concurrent change won (course row lock / unique key race). */
export class CoursesConflictError extends Error {
  constructor(
    message = "This course changed while you were editing. Reload and try again.",
  ) {
    super(message);
    this.name = "CoursesConflictError";
  }
}

export type CoursesRepository = {
  /**
   * Every course the professor owns, as the client store's CoursesState
   * (topics = active canonical topics; bank = lifecycle questions projected to
   * BankQuestion; members = active section members with hashed keys and
   * stats; pinnedSessions = open tutor sessions of members per
   * section:question; activeCourseId = null).
   */
  loadProfessorState(professorUserId: string): Promise<CoursesState>;
  /**
   * Runs `coursesReducer` on the persisted state inside one transaction,
   * persists the row-level diff, appends one course_events row, and returns
   * the fresh professor state.
   */
  applyProfessorAction(
    professorUserId: string,
    action: CoursesAction,
    requestId?: string,
  ): Promise<CoursesState>;
  /**
   * CoursesNotFoundError on a bad or archived code; re-joining the same
   * section is idempotent; joining another section of the same course moves
   * the student (the old membership gets left_at).
   */
  joinSection(
    owner: StudentOwner,
    joinCode: string,
  ): Promise<StudentSectionDto>;
  /** Sets left_at on every active membership. */
  leaveSection(owner: StudentOwner): Promise<void>;
  /** The active membership; with several courses, the most recently joined. */
  getStudentSection(
    owner: StudentOwner,
  ): Promise<StudentSectionDto | undefined>;
  /**
   * Released rows whose question is still published, ordered by
   * topicPosition, then position.
   */
  getSectionReleases(sectionId: string): Promise<SectionReleaseDto[]>;
};

// ---------------------------------------------------------------------------
// Shared rules
// ---------------------------------------------------------------------------

/** Same alphabet as the demo's codes: no 0/O, 1/I/L, 5/S. */
const JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRTUVWXYZ2346789";
const JOIN_CODE_PATTERN = /^[A-Z0-9]{3}-[A-Z0-9]{2}$/;
const ID_SUFFIX_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** Actions the browser store may dispatch that have no database counterpart. */
const DATABASE_REJECTED_ACTIONS = new Set<CoursesAction["type"]>([
  "hydrate",
  "reset",
  "bank/publish",
  "bank/addDraft",
  "course/setActive",
]);

const SUPPORTED_DATABASE_ACTIONS = new Set<string>([
  "course/create",
  "course/clone",
  "course/archive",
  "course/unarchive",
  "course/updateTopic",
  "course/moveTopic",
  "section/create",
  "section/regenerateJoinCode",
  "section/update",
  "section/setTopicState",
  "section/applyReleaseChanges",
  "section/moveReleased",
  "section/updateDelivery",
  "section/moveToVersion",
]);

/**
 * The API validates action shapes, but a nested field that is missing must
 * still read as a bad request rather than as a storage outage.
 */
function guardMalformed<T>(work: () => T): T {
  try {
    return work();
  } catch (cause) {
    if (
      cause instanceof CoursesNotFoundError ||
      cause instanceof CoursesValidationError ||
      cause instanceof CoursesConflictError
    ) {
      throw cause;
    }
    throw new CoursesValidationError("That change is not well formed.");
  }
}

const REVEAL_POLICIES = new Set<SolutionRevealPolicy>([
  "never",
  "after_2_wrong",
  "after_3_wrong",
  "after_correct",
]);
const TOPIC_STATES = new Set<TopicAvailabilityState>([
  "open",
  "closed",
  "scheduled",
]);

/** Repeated-difficulty rule shared with the instructor Students page. */
const ATTENTION_MINIMUM_ATTEMPTS = 4;
const ATTENTION_MAXIMUM_ACCURACY = 0.4;

/** Server-side normalization of a typed or pasted code into `XXX-XX`. */
export function normalizeJoinCode(raw: string) {
  return formatJoinCode(typeof raw === "string" ? raw.trim() : "");
}

export function randomJoinCode() {
  let code = "";
  for (let index = 0; index < 5; index += 1) {
    code += JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)];
  }
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

function randomIdSuffix(length = 6) {
  let suffix = "";
  for (let index = 0; index < length; index += 1) {
    suffix += ID_SUFFIX_ALPHABET[randomInt(ID_SUFFIX_ALPHABET.length)];
  }
  return suffix;
}

/** Same digest input as `STUDENT_KEY_SQL`, so roster keys match analytics. */
export function studentKeyForOwner(owner: StudentOwner) {
  const raw =
    owner.kind === "user"
      ? `user:${owner.userId}`
      : `anon:${owner.anonymousId}`;
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function ownerColumns(owner: StudentOwner): ["user" | "anonymous", string] {
  if (owner.kind === "user") {
    return ["user", owner.userId];
  }
  return ["anonymous", owner.anonymousId];
}

function assertOwner(owner: StudentOwner) {
  const [, ownerId] = ownerColumns(owner);
  if (
    typeof ownerId !== "string" ||
    ownerId.trim() !== ownerId ||
    ownerId.length === 0 ||
    ownerId.length > 200
  ) {
    throw new CoursesValidationError("The student identity is not valid.");
  }
}

function sectionIdOf(action: CoursesAction): string | undefined {
  if ("sectionId" in action && typeof action.sectionId === "string") {
    return action.sectionId;
  }
  if (action.type === "section/create") {
    return action.section.id;
  }
  return undefined;
}

function trimmed(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function requireLength(value: string, min: number, max: number, label: string) {
  if (value.length < min || value.length > max) {
    throw new CoursesValidationError(
      min === max
        ? `${label} must be ${min} characters.`
        : `${label} must be ${min}–${max} characters.`,
    );
  }
  return value;
}

function isoOrThrow(value: unknown, label: string) {
  const time =
    typeof value === "string" || value instanceof Date
      ? new Date(value).getTime()
      : Number.NaN;
  if (!Number.isFinite(time)) {
    throw new CoursesValidationError(`${label} must be a valid date and time.`);
  }
  return new Date(time).toISOString();
}

function validDelivery(delivery: DeliverySettings) {
  if (
    !Number.isInteger(delivery.attemptsAllowed) ||
    delivery.attemptsAllowed < 1 ||
    delivery.attemptsAllowed > 10
  ) {
    throw new CoursesValidationError("Attempts allowed must be 1–10.");
  }
  if (typeof delivery.hintsEnabled !== "boolean") {
    throw new CoursesValidationError("Hints must be on or off.");
  }
  if (!REVEAL_POLICIES.has(delivery.solutionReveal)) {
    throw new CoursesValidationError("Unknown solution reveal setting.");
  }
}

/**
 * Trims free text, stamps the server clock, and drops fields the database
 * owns (status of a new course). The reducer then runs on clean input, so
 * what it returns is what gets persisted.
 */
function normalizeAction(action: CoursesAction, now: string): CoursesAction {
  switch (action.type) {
    case "course/create":
      return {
        type: "course/create",
        course: {
          id: trimmed(action.course.id),
          code: trimmed(action.course.code),
          title: trimmed(action.course.title),
          term: trimmed(action.course.term),
          status: "active",
        },
        includeAllTopics: action.includeAllTopics !== false,
        now,
      };
    case "course/clone":
      return {
        type: "course/clone",
        sourceCourseId: action.sourceCourseId,
        newCourse: {
          id: trimmed(action.newCourse.id),
          code: trimmed(action.newCourse.code),
          title: trimmed(action.newCourse.title),
          term: trimmed(action.newCourse.term),
        },
        now,
      };
    case "course/updateTopic": {
      const patch: Partial<Pick<CourseTopic, "displayLabel" | "included">> = {};
      if ("displayLabel" in action.patch) {
        const label = trimmed(action.patch.displayLabel);
        patch.displayLabel = label.length > 0 ? label : null;
      }
      if ("included" in action.patch) {
        if (typeof action.patch.included !== "boolean") {
          throw new CoursesValidationError("Included must be true or false.");
        }
        patch.included = action.patch.included;
      }
      return { ...action, patch };
    }
    case "section/create":
      return {
        type: "section/create",
        section: {
          id: trimmed(action.section.id),
          courseId: action.section.courseId,
          label: trimmed(action.section.label),
          meetingTime: trimmed(action.section.meetingTime),
        },
        now,
      };
    case "section/update": {
      const patch: Partial<
        Pick<CourseSection, "label" | "meetingTime" | "status">
      > = {};
      if ("label" in action.patch) patch.label = trimmed(action.patch.label);
      if ("meetingTime" in action.patch) {
        patch.meetingTime = trimmed(action.patch.meetingTime);
      }
      if ("status" in action.patch) {
        if (
          action.patch.status !== "active" &&
          action.patch.status !== "archived"
        ) {
          throw new CoursesValidationError("Unknown section status.");
        }
        patch.status = action.patch.status;
      }
      return { ...action, patch };
    }
    case "section/setTopicState": {
      if (!TOPIC_STATES.has(action.state)) {
        throw new CoursesValidationError("Unknown topic state.");
      }
      if (action.state !== "scheduled") {
        return { ...action, opensAt: null };
      }
      return {
        ...action,
        opensAt: isoOrThrow(action.opensAt, "The opening time"),
      };
    }
    case "section/applyReleaseChanges":
      return { ...action, now };
    case "section/updateDelivery": {
      const patch: Partial<DeliverySettings> = {};
      if ("attemptsAllowed" in action.patch) {
        patch.attemptsAllowed = action.patch.attemptsAllowed;
      }
      if ("hintsEnabled" in action.patch) {
        patch.hintsEnabled = action.patch.hintsEnabled;
      }
      if ("solutionReveal" in action.patch) {
        patch.solutionReveal = action.patch.solutionReveal;
      }
      validDelivery({ ...DEFAULT_DELIVERY_SETTINGS, ...patch });
      return { ...action, patch };
    }
    default:
      return action;
  }
}

// ---------------------------------------------------------------------------
// Row projection and diff
// ---------------------------------------------------------------------------

type RowValue = string | number | boolean | null;
type Row = Record<string, RowValue>;

type TableName =
  | "courses"
  | "course_topics"
  | "course_sections"
  | "section_topic_availability"
  | "section_question_availability";

const TABLE_KEYS: Record<TableName, string[]> = {
  courses: ["id"],
  course_topics: ["course_id", "topic_id"],
  course_sections: ["id"],
  section_topic_availability: ["section_id", "topic_id"],
  section_question_availability: ["section_id", "question_id"],
};

/** Insert order respects foreign keys; deletes run in reverse. */
const TABLE_ORDER: TableName[] = [
  "courses",
  "course_topics",
  "course_sections",
  "section_topic_availability",
  "section_question_availability",
];

/** Only release rows are ever removed; nothing else has a DELETE grant. */
const DELETABLE_TABLES = new Set<TableName>(["section_question_availability"]);

type TableRows = Record<TableName, Map<string, Row>>;

function keyOf(table: TableName, row: Row) {
  return TABLE_KEYS[table].map((column) => String(row[column])).join("\u0001");
}

function stableJson(row: Row) {
  return JSON.stringify(
    Object.keys(row)
      .sort()
      .map((key) => [key, row[key]]),
  );
}

function projectState(state: CoursesState): TableRows {
  const rows: TableRows = {
    courses: new Map(),
    course_topics: new Map(),
    course_sections: new Map(),
    section_topic_availability: new Map(),
    section_question_availability: new Map(),
  };
  const put = (table: TableName, row: Row) =>
    rows[table].set(keyOf(table, row), row);

  for (const course of state.courses) {
    put("courses", {
      id: course.id,
      code: course.code,
      title: course.title,
      term: course.term,
      status: course.status,
    });
  }
  for (const row of state.courseTopics) {
    put("course_topics", {
      course_id: row.courseId,
      topic_id: row.topicId,
      position: row.position,
      display_label: row.displayLabel,
      included: row.included,
    });
  }
  for (const section of state.sections) {
    put("course_sections", {
      id: section.id,
      course_id: section.courseId,
      label: section.label,
      meeting_time: section.meetingTime,
      join_code: section.joinCode,
      status: section.status,
    });
  }
  for (const row of state.topicAvailability) {
    put("section_topic_availability", {
      section_id: row.sectionId,
      topic_id: row.topicId,
      state: row.state,
      opens_at: row.opensAt,
    });
  }
  for (const row of state.questionAvailability) {
    put("section_question_availability", {
      section_id: row.sectionId,
      question_id: row.questionId,
      state: row.state,
      released_at: row.releasedAt,
      released_version: row.releasedVersion,
      position: row.position,
      attempts_allowed: row.delivery.attemptsAllowed,
      hints_enabled: row.delivery.hintsEnabled,
      solution_reveal: row.delivery.solutionReveal,
    });
  }
  return rows;
}

type TableDiff = {
  inserts: Row[];
  updates: { before: Row; after: Row }[];
  deletes: Row[];
};

type StateDiff = Record<TableName, TableDiff>;

function diffStates(before: TableRows, after: TableRows): StateDiff {
  const diff = {} as StateDiff;
  for (const table of TABLE_ORDER) {
    const tableDiff: TableDiff = { inserts: [], updates: [], deletes: [] };
    for (const [key, row] of after[table]) {
      const previous = before[table].get(key);
      if (!previous) {
        tableDiff.inserts.push(row);
      } else if (stableJson(previous) !== stableJson(row)) {
        tableDiff.updates.push({ before: previous, after: row });
      }
    }
    for (const [key, row] of before[table]) {
      if (!after[table].has(key)) tableDiff.deletes.push(row);
    }
    diff[table] = tableDiff;
  }
  return diff;
}

function diffIsEmpty(diff: StateDiff) {
  return TABLE_ORDER.every(
    (table) =>
      diff[table].inserts.length === 0 &&
      diff[table].updates.length === 0 &&
      diff[table].deletes.length === 0,
  );
}

function diffCounts(diff: StateDiff) {
  return Object.fromEntries(
    TABLE_ORDER.map((table) => [
      table,
      {
        deleted: diff[table].deletes.length,
        inserted: diff[table].inserts.length,
        updated: diff[table].updates.length,
      },
    ]),
  );
}

/** Mirrors the migration's check constraints with professor-facing messages. */
function validateRow(table: TableName, row: Row) {
  switch (table) {
    case "courses":
      if (!isCourseEntityId(String(row.id))) {
        throw new CoursesValidationError("The course id is not valid.");
      }
      requireLength(String(row.code), 2, 32, "Course code");
      requireLength(String(row.title), 1, 120, "Course title");
      requireLength(String(row.term), 1, 40, "Term");
      return;
    case "course_topics":
      if (!Number.isInteger(row.position) || Number(row.position) < 0) {
        throw new CoursesValidationError("Topic position is not valid.");
      }
      if (row.display_label !== null) {
        requireLength(String(row.display_label), 1, 120, "Topic label");
      }
      return;
    case "course_sections":
      if (!isCourseEntityId(String(row.id))) {
        throw new CoursesValidationError("The section id is not valid.");
      }
      requireLength(String(row.label), 1, 60, "Section name");
      requireLength(String(row.meeting_time), 0, 80, "Meeting time");
      if (row.status !== "active" && row.status !== "archived") {
        throw new CoursesValidationError("Unknown section status.");
      }
      return;
    case "section_topic_availability":
      if ((row.state === "scheduled") !== (row.opens_at !== null)) {
        throw new CoursesValidationError(
          "A scheduled topic needs an opening time.",
        );
      }
      return;
    case "section_question_availability":
      if (!Number.isInteger(row.position) || Number(row.position) < 0) {
        throw new CoursesValidationError("Question position is not valid.");
      }
      validDelivery({
        attemptsAllowed: Number(row.attempts_allowed),
        hintsEnabled: row.hints_enabled as boolean,
        solutionReveal: row.solution_reveal as SolutionRevealPolicy,
      });
      if (row.state === "released" && row.released_version === null) {
        throw new CoursesValidationError(
          "Only a published version can be released.",
        );
      }
      return;
  }
}

// ---------------------------------------------------------------------------
// Database reads
// ---------------------------------------------------------------------------

async function readRows<T>(
  query: DatabaseQueryExecutor,
  sql: string,
  params: DatabaseQueryValue[] = [],
) {
  return (await readDatabaseRows(query, sql, params)) as T[];
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.length > 0) {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? new Date(time).toISOString() : value;
  }
  return "";
}

function isoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value);
}

function toInt(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        for (const field of ["body", "feedback", "label", "description"]) {
          if (typeof record[field] === "string") return record[field] as string;
        }
      }
      return "";
    })
    .filter((item) => item.length > 0);
}

function bankDifficulty(value: unknown): Difficulty {
  if (value === "foundational" || value === "challenge") return value;
  return "core";
}

function bankAnswerType(kind: unknown, numericValue: unknown): AnswerType {
  if (kind === "numeric" || kind === "categorical") return kind;
  if (typeof kind === "string" && kind.length > 0) return "expression";
  return numericValue !== null && numericValue !== undefined
    ? "numeric"
    : "categorical";
}

function bankState(
  publishedVersion: number | null,
  recordState: unknown,
  workingState: unknown,
): QuestionLifecycleState {
  if (publishedVersion !== null) return "published";
  if (recordState !== "active") return "unpublished";
  switch (workingState) {
    case "draft":
    case "rejected":
      return "draft";
    case "needs_review":
    case "revision_requested":
      return "needs_review";
    case "approved":
      return "approved";
    default:
      return "unpublished";
  }
}

const OWNED_COURSES_SQL = `select c.id from courses c where c.owner_user_id = $1`;

async function readTopics(query: DatabaseQueryExecutor) {
  const rows = await readRows<{
    description: string | null;
    id: string;
    sort_order: number | string;
    title: string;
    week_number: number | string | null;
  }>(
    query,
    `select id, title, description, sort_order, week_number
     from topics
     where is_active
     order by sort_order, id`,
  );
  return rows.map<CanonicalTopic>((row, index) => ({
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    order: toInt(row.sort_order, index),
    weekNumber:
      row.week_number === null ? index + 1 : toInt(row.week_number, index + 1),
    active: true,
  }));
}

async function readBank(query: DatabaseQueryExecutor, professorUserId: string) {
  const rows = await readRows<Record<string, unknown>>(
    query,
    `select
       q.id,
       q.record_state,
       coalesce(content.snapshot_json ->> 'topicId', q.topic_id) as topic_id,
       coalesce(content.snapshot_json ->> 'title', q.title) as title,
       coalesce(content.snapshot_json ->> 'prompt', q.prompt) as prompt,
       content.snapshot_json ->> 'difficulty' as difficulty,
       content.snapshot_json #>> '{answer,spec,kind}' as answer_kind,
       content.snapshot_json -> 'acceptedAnswers' as accepted_answers,
       content.snapshot_json ->> 'numericValue' as numeric_value,
       content.snapshot_json -> 'hints' as hints,
       content.snapshot_json -> 'solutionSteps' as solution_steps,
       content.snapshot_json -> 'misconceptions' as misconceptions,
       working_lifecycle.state as working_state,
       published.version_number as published_version,
       (
         select max(v.version_number)
         from question_versions v
         where v.question_id = q.id
       ) as latest_version,
       q.updated_at
     from questions q
     join question_versions content
       on content.id = coalesce(q.published_version_id, q.working_version_id)
     left join question_versions published
       on published.id = q.published_version_id
     left join question_version_lifecycle working_lifecycle
       on working_lifecycle.question_version_id = q.working_version_id
     where q.record_state = 'active'
       or q.id in (
         select sqa.question_id
         from section_question_availability sqa
         join course_sections cs on cs.id = sqa.section_id
         where cs.course_id in (${OWNED_COURSES_SQL})
       )
     order by q.id`,
    [professorUserId],
  );
  return rows.map<BankQuestion>((row) => {
    const publishedVersion =
      row.published_version === null || row.published_version === undefined
        ? null
        : toInt(row.published_version);
    const accepted = textList(row.accepted_answers);
    return {
      id: String(row.id),
      topicId: String(row.topic_id ?? ""),
      title: String(row.title ?? ""),
      prompt: String(row.prompt ?? ""),
      answerType: bankAnswerType(row.answer_kind, row.numeric_value),
      difficulty: bankDifficulty(row.difficulty),
      state: bankState(publishedVersion, row.record_state, row.working_state),
      publishedVersion,
      latestVersion: toInt(row.latest_version, publishedVersion ?? 1),
      finalAnswer:
        accepted[0] ??
        (row.numeric_value === null || row.numeric_value === undefined
          ? ""
          : String(row.numeric_value)),
      hints: textList(row.hints),
      solutionSteps: textList(row.solution_steps),
      misconceptions: textList(row.misconceptions),
      tags: [],
      updatedAt: iso(row.updated_at),
    };
  });
}

async function readCourseRows(
  query: DatabaseQueryExecutor,
  professorUserId: string,
) {
  const courses = await readRows<Record<string, unknown>>(
    query,
    `select id, code, title, term, status, created_at
     from courses
     where owner_user_id = $1
     order by created_at, id`,
    [professorUserId],
  );
  const courseTopics = await readRows<Record<string, unknown>>(
    query,
    `select course_id, topic_id, position, display_label, included
     from course_topics
     where course_id in (${OWNED_COURSES_SQL})
     order by course_id, position, topic_id`,
    [professorUserId],
  );
  const sections = await readRows<Record<string, unknown>>(
    query,
    `select id, course_id, label, meeting_time, join_code, status, created_at
     from course_sections
     where course_id in (${OWNED_COURSES_SQL})
     order by created_at, id`,
    [professorUserId],
  );
  const topicAvailability = await readRows<Record<string, unknown>>(
    query,
    `select sta.section_id, sta.topic_id, sta.state, sta.opens_at
     from section_topic_availability sta
     join course_sections cs on cs.id = sta.section_id
     where cs.course_id in (${OWNED_COURSES_SQL})
     order by sta.section_id, sta.topic_id`,
    [professorUserId],
  );
  const questionAvailability = await readRows<Record<string, unknown>>(
    query,
    `select
       sqa.section_id,
       sqa.question_id,
       sqa.state,
       sqa.released_at,
       qv.version_number as released_version,
       sqa.position,
       sqa.attempts_allowed,
       sqa.hints_enabled,
       sqa.solution_reveal
     from section_question_availability sqa
     join course_sections cs on cs.id = sqa.section_id
     left join question_versions qv on qv.id = sqa.released_version_id
     where cs.course_id in (${OWNED_COURSES_SQL})
     order by sqa.section_id, sqa.position, sqa.question_id`,
    [professorUserId],
  );

  return {
    courses: courses.map<Course>((row) => ({
      id: String(row.id),
      code: String(row.code),
      title: String(row.title),
      term: String(row.term),
      status: row.status === "archived" ? "archived" : "active",
      createdAt: iso(row.created_at),
    })),
    courseTopics: courseTopics.map<CourseTopic>((row) => ({
      courseId: String(row.course_id),
      topicId: String(row.topic_id),
      position: toInt(row.position),
      displayLabel:
        row.display_label === null ? null : String(row.display_label),
      included: Boolean(row.included),
    })),
    sections: sections.map<CourseSection>((row) => ({
      id: String(row.id),
      courseId: String(row.course_id),
      label: String(row.label),
      meetingTime: String(row.meeting_time ?? ""),
      joinCode: String(row.join_code),
      status: row.status === "archived" ? "archived" : "active",
      createdAt: iso(row.created_at),
    })),
    topicAvailability: topicAvailability.map<SectionTopicAvailability>(
      (row) => ({
        sectionId: String(row.section_id),
        topicId: String(row.topic_id),
        state: row.state as TopicAvailabilityState,
        opensAt: isoOrNull(row.opens_at),
      }),
    ),
    questionAvailability: questionAvailability.map<SectionQuestionAvailability>(
      (row) => ({
        sectionId: String(row.section_id),
        questionId: String(row.question_id),
        state: row.state === "released" ? "released" : "held",
        releasedAt: isoOrNull(row.released_at),
        releasedVersion:
          row.released_version === null || row.released_version === undefined
            ? null
            : toInt(row.released_version),
        position: toInt(row.position),
        delivery: {
          attemptsAllowed: toInt(row.attempts_allowed, 3),
          hintsEnabled: Boolean(row.hints_enabled),
          solutionReveal: row.solution_reveal as SolutionRevealPolicy,
        },
      }),
    ),
  };
}

const MEMBER_OWNER_MATCH_SQL = `(
  (m.owner_kind = 'user' and s.user_id = m.owner_id)
  or (m.owner_kind = 'anonymous' and s.anonymous_user_id = m.owner_id)
)`;

const MEMBER_KEY_SQL = `encode(
  sha256(
    convert_to(
      case m.owner_kind
        when 'user' then 'user:' || m.owner_id
        else 'anon:' || m.owner_id
      end,
      'UTF8'
    )
  ),
  'hex'
)`;

/**
 * Active members with the same totals the instructor Students page reports
 * (meaningful published-practice sessions, answer checks, correct checks,
 * hints), restricted to activity since the student joined this section.
 * Only the hashed key leaves this query.
 */
async function readMembers(
  query: DatabaseQueryExecutor,
  professorUserId: string,
  topics: CanonicalTopic[],
) {
  const members = await readRows<Record<string, unknown>>(
    query,
    `with members as (
       select m.section_id, m.owner_kind, m.owner_id, m.joined_at,
         ${MEMBER_KEY_SQL} as student_key
       from section_members m
       join course_sections cs on cs.id = m.section_id
       where m.left_at is null
         and cs.course_id in (${OWNED_COURSES_SQL})
     ),
     member_sessions as (
       select m.section_id, m.student_key, s.id as session_id,
         s.revealed_hints, s.last_seen_at
       from members m
       join tutor_sessions s on ${MEMBER_OWNER_MATCH_SQL}
       where s.created_at >= m.joined_at
         and s.practice_context = 'published'
         and ${ANALYTICS_STUDENT_SESSION_FILTER_SQL}
     ),
     session_totals as (
       select section_id, student_key,
         count(*)::int as sessions,
         coalesce(sum(revealed_hints), 0)::int as hints_used,
         max(last_seen_at) as last_active_at
       from member_sessions
       group by section_id, student_key
     ),
     attempt_totals as (
       select ms.section_id, ms.student_key,
         count(*) filter (where a.mode = 'check')::int as attempts,
         count(*) filter (
           where a.mode = 'check' and a.verdict = 'correct'
         )::int as correct_attempts
       from member_sessions ms
       join attempts a on a.session_id = ms.session_id
       group by ms.section_id, ms.student_key
     )
     select m.section_id, m.student_key, m.joined_at,
       coalesce(st.sessions, 0) as sessions,
       coalesce(st.hints_used, 0) as hints_used,
       st.last_active_at,
       coalesce(t.attempts, 0) as attempts,
       coalesce(t.correct_attempts, 0) as correct_attempts
     from members m
     left join session_totals st
       on st.section_id = m.section_id and st.student_key = m.student_key
     left join attempt_totals t
       on t.section_id = m.section_id and t.student_key = m.student_key
     order by m.section_id, m.joined_at, m.student_key`,
    [professorUserId],
  );
  if (members.length === 0) return [];

  const topicRows = await readRows<Record<string, unknown>>(
    query,
    `with members as (
       select m.section_id, m.owner_kind, m.owner_id, m.joined_at,
         ${MEMBER_KEY_SQL} as student_key
       from section_members m
       join course_sections cs on cs.id = m.section_id
       where m.left_at is null
         and cs.course_id in (${OWNED_COURSES_SQL})
     )
     select m.section_id, m.student_key, a.topic_id,
       count(*)::int as graded,
       count(*) filter (where a.verdict = 'correct')::int as correct
     from members m
     join tutor_sessions s on ${MEMBER_OWNER_MATCH_SQL}
     join attempts a on a.session_id = s.id
     where s.created_at >= m.joined_at
       and s.practice_context = 'published'
       and ${ANALYTICS_STUDENT_SESSION_FILTER_SQL}
       and ${VALID_ANSWER_ATTEMPT_SQL}
       and a.topic_id is not null
     group by m.section_id, m.student_key, a.topic_id`,
    [professorUserId],
  );

  const topicTitle = new Map(topics.map((topic) => [topic.id, topic.title]));
  const perMember = new Map<
    string,
    { topicId: string; graded: number; correct: number }[]
  >();
  for (const row of topicRows) {
    const key = `${row.section_id}\u0001${row.student_key}`;
    const list = perMember.get(key) ?? [];
    list.push({
      topicId: String(row.topic_id),
      graded: toInt(row.graded),
      correct: toInt(row.correct),
    });
    perMember.set(key, list);
  }

  return members.map<SectionMember>((row) => {
    const topicStats =
      perMember.get(`${row.section_id}\u0001${row.student_key}`) ?? [];
    const topicMastery: Record<string, number> = {};
    let attention: { topicId: string; accuracy: number } | undefined;
    for (const stat of topicStats) {
      if (stat.graded === 0) continue;
      const accuracy = stat.correct / stat.graded;
      topicMastery[stat.topicId] = Math.round(accuracy * 100);
      if (
        stat.graded >= ATTENTION_MINIMUM_ATTEMPTS &&
        accuracy <= ATTENTION_MAXIMUM_ACCURACY &&
        (!attention || accuracy < attention.accuracy)
      ) {
        attention = { topicId: stat.topicId, accuracy };
      }
    }
    const joinedAt = iso(row.joined_at);
    return {
      sectionId: String(row.section_id),
      studentKey: String(row.student_key),
      joinedAt,
      lastActiveAt: row.last_active_at ? iso(row.last_active_at) : joinedAt,
      sessions: toInt(row.sessions),
      attempts: toInt(row.attempts),
      correctAttempts: toInt(row.correct_attempts),
      hintsUsed: toInt(row.hints_used),
      attentionNote: attention
        ? `Repeated difficulty on ${topicTitle.get(attention.topicId) ?? "a topic"}`
        : null,
      topicMastery,
    };
  });
}

async function readPinnedSessions(
  query: DatabaseQueryExecutor,
  professorUserId: string,
) {
  const rows = await readRows<{
    question_id: string;
    section_id: string;
    sessions: number | string;
  }>(
    query,
    `select sqa.section_id, sqa.question_id, count(distinct s.id)::int as sessions
     from section_question_availability sqa
     join course_sections cs on cs.id = sqa.section_id
     join section_members m
       on m.section_id = sqa.section_id and m.left_at is null
     join tutor_sessions s
       on s.question_id = sqa.question_id
      and s.question_version_id = sqa.released_version_id
      and ${MEMBER_OWNER_MATCH_SQL}
     where cs.course_id in (${OWNED_COURSES_SQL})
       and sqa.state = 'released'
       and s.status = 'active'
       and not s.solved
       and (s.expires_at is null or s.expires_at > now())
     group by sqa.section_id, sqa.question_id`,
    [professorUserId],
  );
  const pinned: Record<string, number> = {};
  for (const row of rows) {
    const count = toInt(row.sessions);
    if (count > 0) pinned[`${row.section_id}:${row.question_id}`] = count;
  }
  return pinned;
}

async function readProfessorState(
  query: DatabaseQueryExecutor,
  professorUserId: string,
  options: { activity: boolean },
): Promise<CoursesState> {
  const topics = await readTopics(query);
  const bank = await readBank(query, professorUserId);
  const rows = await readCourseRows(query, professorUserId);
  const members = options.activity
    ? await readMembers(query, professorUserId, topics)
    : [];
  const pinnedSessions = options.activity
    ? await readPinnedSessions(query, professorUserId)
    : {};
  return {
    schemaVersion: 1,
    activeCourseId: null,
    topics,
    bank,
    ...rows,
    members,
    pinnedSessions,
  };
}

// ---------------------------------------------------------------------------
// Database writes
// ---------------------------------------------------------------------------

function sqlStateOf(cause: unknown): string | undefined {
  if (!cause || typeof cause !== "object") return undefined;
  const record = cause as { code?: unknown; sqlState?: unknown };
  if (typeof record.sqlState === "string") return record.sqlState;
  if (typeof record.code === "string" && /^[0-9A-Z]{5}$/.test(record.code)) {
    return record.code;
  }
  return undefined;
}

function isDomainError(cause: unknown) {
  return (
    cause instanceof CoursesNotFoundError ||
    cause instanceof CoursesValidationError ||
    cause instanceof CoursesConflictError
  );
}

/**
 * Turns database rejections into the three domain errors. Anything else
 * (connection loss, permissions) is rethrown for the data-store to report as
 * an outage.
 */
function mapWriteError(cause: unknown): never {
  if (isDomainError(cause)) throw cause;
  const sqlState = sqlStateOf(cause);
  if (sqlState === "23505") throw new CoursesConflictError();
  if (sqlState === "40001" || sqlState === "40P01" || sqlState === "55P03") {
    throw new CoursesConflictError();
  }
  if (
    sqlState === "23514" ||
    sqlState === "23502" ||
    sqlState === "23503" ||
    sqlState?.startsWith("22")
  ) {
    throw new CoursesValidationError();
  }
  throw cause;
}

async function insertRow(
  query: DatabaseQueryExecutor,
  table: string,
  row: Row,
) {
  const columns = Object.keys(row);
  await query(
    `insert into ${table} (${columns.join(", ")}) values (${columns
      .map((_, index) => `$${index + 1}`)
      .join(", ")})`,
    columns.map((column) => row[column]),
  );
}

async function updateRow(
  query: DatabaseQueryExecutor,
  table: TableName,
  row: Row,
) {
  const keys = TABLE_KEYS[table];
  const columns = Object.keys(row).filter((column) => !keys.includes(column));
  const params = [
    ...columns.map((column) => row[column]),
    ...keys.map((key) => row[key]),
  ];
  await query(
    `update ${table} set ${columns
      .map((column, index) => `${column} = $${index + 1}`)
      .join(", ")} where ${keys
      .map((key, index) => `${key} = $${columns.length + index + 1}`)
      .join(" and ")}`,
    params,
  );
}

async function deleteRow(
  query: DatabaseQueryExecutor,
  table: TableName,
  row: Row,
) {
  const keys = TABLE_KEYS[table];
  await query(
    `delete from ${table} where ${keys
      .map((key, index) => `${key} = $${index + 1}`)
      .join(" and ")}`,
    keys.map((key) => row[key]),
  );
}

async function idTaken(
  query: DatabaseQueryExecutor,
  table: "courses" | "course_sections",
  id: string,
) {
  const rows = await query(`select 1 from ${table} where id = $1`, [id]);
  return rows.length > 0;
}

/**
 * Keeps a client-proposed id when it is well formed and unused anywhere, so
 * the optimistic UI and the server agree; otherwise derives a fresh one.
 */
async function serverEntityId(
  query: DatabaseQueryExecutor,
  table: "courses" | "course_sections",
  proposed: string,
) {
  if (isCourseEntityId(proposed) && !(await idTaken(query, table, proposed))) {
    return proposed;
  }
  const base =
    proposed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 160) || (table === "courses" ? "course" : "section");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `${base}-${randomIdSuffix()}`;
    if (!(await idTaken(query, table, candidate))) return candidate;
  }
  throw new CoursesConflictError();
}

async function uniqueJoinCode(
  query: DatabaseQueryExecutor,
  reserved: Set<string>,
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = randomJoinCode();
    if (reserved.has(code)) continue;
    const rows = await query(
      `select 1 from course_sections where join_code = $1`,
      [code],
    );
    if (rows.length === 0) {
      reserved.add(code);
      return code;
    }
  }
  throw new CoursesConflictError();
}

/** Locks the owned course row; a course the professor does not own is 404. */
async function lockOwnedCourse(
  query: DatabaseQueryExecutor,
  professorUserId: string,
  courseId: unknown,
) {
  if (typeof courseId !== "string" || courseId.length === 0) {
    throw new CoursesNotFoundError();
  }
  const rows = await query(
    `select id from courses where id = $1 and owner_user_id = $2 for update`,
    [courseId, professorUserId],
  );
  if (rows.length === 0) throw new CoursesNotFoundError();
  return courseId;
}

async function lockOwnedSectionCourse(
  query: DatabaseQueryExecutor,
  professorUserId: string,
  sectionId: unknown,
) {
  if (typeof sectionId !== "string" || sectionId.length === 0) {
    throw new CoursesNotFoundError();
  }
  const rows = await query(
    `select cs.course_id
     from course_sections cs
     join courses c on c.id = cs.course_id
     where cs.id = $1 and c.owner_user_id = $2`,
    [sectionId, professorUserId],
  );
  if (rows.length === 0) throw new CoursesNotFoundError();
  return lockOwnedCourse(query, professorUserId, rows[0].course_id);
}

/**
 * Resolves (and locks) the course an action affects, rewriting ids proposed
 * by the client when they are malformed or already used elsewhere.
 */
async function prepareAction(
  query: DatabaseQueryExecutor,
  professorUserId: string,
  action: CoursesAction,
): Promise<{ action: CoursesAction; courseId: string }> {
  switch (action.type) {
    case "course/create": {
      const id = await serverEntityId(query, "courses", action.course.id);
      return {
        action: { ...action, course: { ...action.course, id } },
        courseId: id,
      };
    }
    case "course/clone": {
      await lockOwnedCourse(query, professorUserId, action.sourceCourseId);
      const id = await serverEntityId(query, "courses", action.newCourse.id);
      return {
        action: { ...action, newCourse: { ...action.newCourse, id } },
        courseId: id,
      };
    }
    case "course/archive":
    case "course/unarchive":
    case "course/updateTopic":
    case "course/moveTopic":
      return {
        action,
        courseId: await lockOwnedCourse(
          query,
          professorUserId,
          action.courseId,
        ),
      };
    case "section/create": {
      const courseId = await lockOwnedCourse(
        query,
        professorUserId,
        action.section.courseId,
      );
      const id = await serverEntityId(
        query,
        "course_sections",
        action.section.id,
      );
      return {
        action: { ...action, section: { ...action.section, id } },
        courseId,
      };
    }
    default: {
      const sectionId = sectionIdOf(action);
      return {
        action,
        courseId: await lockOwnedSectionCourse(
          query,
          professorUserId,
          sectionId,
        ),
      };
    }
  }
}

async function resolveVersionIds(query: DatabaseQueryExecutor, rows: Row[]) {
  const versionIds = new Map<string, number>();
  for (const row of rows) {
    if (row.released_version === null) continue;
    const key = `${row.question_id}\u0001${row.released_version}`;
    if (versionIds.has(key)) continue;
    const found = await query(
      `select id from question_versions
       where question_id = $1 and version_number = $2`,
      [row.question_id, row.released_version],
    );
    if (found.length === 0) {
      throw new CoursesValidationError("That question version does not exist.");
    }
    versionIds.set(key, toInt(found[0].id));
  }
  return (row: Row): Row => {
    const { released_version: version, ...rest } = row;
    return {
      ...rest,
      released_version_id:
        version === null
          ? null
          : (versionIds.get(`${row.question_id}\u0001${version}`) as number),
    };
  };
}

/**
 * The reducer pins whatever `publishedVersion` the bank says; the database is
 * the authority, so a row that becomes released (or moves version while
 * released) must name the question's currently published version.
 */
function assertPublishedPins(diff: StateDiff, bank: BankQuestion[]) {
  const published = new Map(
    bank.map((question) => [question.id, question.publishedVersion]),
  );
  const changes = [
    ...diff.section_question_availability.inserts.map((after) => ({
      after,
      before: undefined as Row | undefined,
    })),
    ...diff.section_question_availability.updates,
  ];
  for (const { after, before } of changes) {
    if (after.state !== "released") continue;
    const changedPin =
      !before ||
      before.state !== "released" ||
      before.released_version !== after.released_version;
    if (!changedPin) continue;
    const current = published.get(String(after.question_id));
    if (current === null || current === undefined) {
      throw new CoursesValidationError(
        "Only a published question can be released.",
      );
    }
    if (after.released_version !== current) {
      throw new CoursesValidationError(
        `Only the published version (v${current}) can be released.`,
      );
    }
  }
}

function courseOfRow(
  table: TableName,
  row: Row,
  sectionCourse: Map<string, string>,
) {
  if (table === "courses") return String(row.id);
  if (table === "course_topics" || table === "course_sections") {
    return String(row.course_id);
  }
  return sectionCourse.get(String(row.section_id));
}

export function createDatabaseCoursesRepository(
  query: DatabaseQueryExecutor,
): CoursesRepository {
  async function loadProfessorState(professorUserId: string) {
    return readProfessorState(query, professorUserId, { activity: true });
  }

  async function applyProfessorAction(
    professorUserId: string,
    rawAction: CoursesAction,
    requestId?: string,
  ) {
    if (!rawAction || typeof rawAction !== "object") {
      throw new CoursesValidationError("Unknown action.");
    }
    if (DATABASE_REJECTED_ACTIONS.has(rawAction.type)) {
      throw new CoursesValidationError(
        `${rawAction.type} is not available for saved courses.`,
      );
    }
    if (!SUPPORTED_DATABASE_ACTIONS.has(rawAction.type)) {
      throw new CoursesValidationError("Unknown action.");
    }
    const now = new Date().toISOString();
    const normalized = guardMalformed(() => normalizeAction(rawAction, now));
    const request =
      typeof requestId === "string" && requestId.trim().length > 0
        ? requestId.trim().slice(0, 200)
        : null;

    try {
      await runDatabaseTransaction(
        query,
        async (tx) => {
          const { action, courseId } = await prepareAction(
            tx,
            professorUserId,
            normalized,
          );
          const before = await readProfessorState(tx, professorUserId, {
            activity: false,
          });
          const after = guardMalformed(() => coursesReducer(before, action));
          if (after === before) return;

          const beforeRows = projectState(before);
          const afterRows = projectState(after);

          // Join codes are random on the server: the reducer's deterministic
          // codes are predictable from the section id.
          const reservedCodes = new Set(
            [...afterRows.course_sections.values()].map((row) =>
              String(row.join_code),
            ),
          );
          for (const [key, row] of afterRows.course_sections) {
            const previous = beforeRows.course_sections.get(key);
            if (!previous || previous.join_code !== row.join_code) {
              afterRows.course_sections.set(key, {
                ...row,
                join_code: await uniqueJoinCode(tx, reservedCodes),
              });
            }
          }

          const diff = diffStates(beforeRows, afterRows);
          if (diffIsEmpty(diff)) return;

          const sectionCourse = new Map(
            after.sections.map((section) => [section.id, section.courseId]),
          );
          const existingCodes = new Set(
            before.courses
              .filter((course) => course.id !== courseId)
              .map((course) => `${course.code}\u0001${course.term}`),
          );
          for (const table of TABLE_ORDER) {
            const touched = [
              ...diff[table].inserts,
              ...diff[table].updates.map((update) => update.after),
              ...diff[table].deletes,
            ];
            for (const row of touched) {
              if (courseOfRow(table, row, sectionCourse) !== courseId) {
                throw new CoursesValidationError(
                  "An action can only change one course.",
                );
              }
            }
            for (const row of [
              ...diff[table].inserts,
              ...diff[table].updates.map((update) => update.after),
            ]) {
              validateRow(table, row);
            }
            if (
              diff[table].deletes.length > 0 &&
              !DELETABLE_TABLES.has(table)
            ) {
              throw new CoursesValidationError("That change is not allowed.");
            }
          }
          for (const row of diff.courses.inserts) {
            if (existingCodes.has(`${row.code}\u0001${row.term}`)) {
              throw new CoursesValidationError(
                `You already have ${row.code} for ${row.term}.`,
              );
            }
          }
          assertPublishedPins(diff, before.bank);

          const toDatabaseRow = await resolveVersionIds(tx, [
            ...diff.section_question_availability.inserts,
            ...diff.section_question_availability.updates.map(
              (update) => update.after,
            ),
          ]);

          for (const table of [...TABLE_ORDER].reverse()) {
            for (const row of diff[table].deletes) {
              await deleteRow(tx, table, row);
            }
          }
          for (const table of TABLE_ORDER) {
            for (const row of diff[table].inserts) {
              if (table === "courses") {
                await insertRow(tx, table, {
                  ...row,
                  owner_user_id: professorUserId,
                  created_by_user_id: professorUserId,
                  archived_at: row.status === "archived" ? now : null,
                });
              } else if (table === "section_question_availability") {
                await insertRow(tx, table, toDatabaseRow(row));
              } else {
                await insertRow(tx, table, row);
              }
            }
            for (const { before: previous, after: row } of diff[table]
              .updates) {
              if (table === "courses") {
                await updateRow(tx, table, {
                  ...row,
                  ...(previous.status !== row.status
                    ? { archived_at: row.status === "archived" ? now : null }
                    : {}),
                });
              } else if (table === "section_question_availability") {
                await updateRow(tx, table, toDatabaseRow(row));
              } else {
                await updateRow(tx, table, row);
              }
            }
          }

          const sectionId = sectionIdOf(action);
          await tx(
            `insert into course_events (
               course_id, section_id, actor_user_id, action, payload_json,
               request_id
             ) values ($1, $2, $3, $4, $5::jsonb, $6)`,
            [
              courseId,
              sectionId && sectionCourse.get(sectionId) === courseId
                ? sectionId
                : null,
              professorUserId,
              action.type,
              JSON.stringify({ action, rows: diffCounts(diff) }),
              request,
            ],
          );
        },
        { retryOnConflict: true },
      );
    } catch (cause) {
      mapWriteError(cause);
    }

    return loadProfessorState(professorUserId);
  }

  async function sectionDtoByCode(tx: DatabaseQueryExecutor, joinCode: string) {
    const rows = await tx(
      `select cs.id as section_id, cs.label, c.id as course_id, c.code,
         c.title, c.term
       from course_sections cs
       join courses c on c.id = cs.course_id
       where cs.join_code = $1
         and cs.status = 'active'
         and c.status = 'active'`,
      [joinCode],
    );
    return rows[0];
  }

  async function joinSection(owner: StudentOwner, rawCode: string) {
    assertOwner(owner);
    const joinCode = normalizeJoinCode(rawCode);
    if (!JOIN_CODE_PATTERN.test(joinCode)) {
      throw new CoursesNotFoundError("We don't recognise that code.");
    }
    const [ownerKind, ownerId] = ownerColumns(owner);
    try {
      return await runDatabaseTransaction(
        query,
        async (tx) => {
          const section = await sectionDtoByCode(tx, joinCode);
          if (!section) {
            throw new CoursesNotFoundError("We don't recognise that code.");
          }
          const existing = await tx(
            `select section_id, joined_at
             from section_members
             where course_id = $1 and owner_kind = $2 and owner_id = $3
               and left_at is null
             for update`,
            [String(section.course_id), ownerKind, ownerId],
          );
          let joinedAt: string;
          if (existing.some((row) => row.section_id === section.section_id)) {
            joinedAt = iso(
              existing.find((row) => row.section_id === section.section_id)
                ?.joined_at,
            );
          } else {
            const now = new Date().toISOString();
            await tx(
              `update section_members
               set left_at = greatest($4::timestamptz, joined_at)
               where course_id = $1 and owner_kind = $2 and owner_id = $3
                 and left_at is null`,
              [String(section.course_id), ownerKind, ownerId, now],
            );
            const rejoined = await tx(
              `update section_members
               set left_at = null, joined_at = $4
               where section_id = $1 and owner_kind = $2 and owner_id = $3
               returning joined_at`,
              [String(section.section_id), ownerKind, ownerId, now],
            );
            if (rejoined.length === 0) {
              await tx(
                `insert into section_members (
                   section_id, course_id, owner_kind, owner_id, joined_at
                 ) values ($1, $2, $3, $4, $5)`,
                [
                  String(section.section_id),
                  String(section.course_id),
                  ownerKind,
                  ownerId,
                  now,
                ],
              );
            }
            joinedAt = now;
          }
          return {
            sectionId: String(section.section_id),
            sectionLabel: String(section.label),
            courseId: String(section.course_id),
            courseCode: String(section.code),
            courseTitle: String(section.title),
            term: String(section.term),
            joinedAt,
          } satisfies StudentSectionDto;
        },
        { retryOnConflict: true },
      );
    } catch (cause) {
      return mapWriteError(cause);
    }
  }

  async function leaveSection(owner: StudentOwner) {
    assertOwner(owner);
    const [ownerKind, ownerId] = ownerColumns(owner);
    await query(
      `update section_members
       set left_at = greatest(now(), joined_at)
       where owner_kind = $1 and owner_id = $2 and left_at is null`,
      [ownerKind, ownerId],
    );
  }

  async function getStudentSection(owner: StudentOwner) {
    assertOwner(owner);
    const [ownerKind, ownerId] = ownerColumns(owner);
    const rows = await readRows<Record<string, unknown>>(
      query,
      `select cs.id as section_id, cs.label, c.id as course_id, c.code,
         c.title, c.term, m.joined_at
       from section_members m
       join course_sections cs on cs.id = m.section_id
       join courses c on c.id = m.course_id
       where m.owner_kind = $1 and m.owner_id = $2
         and m.left_at is null
         and cs.status = 'active'
         and c.status = 'active'
       order by m.joined_at desc, cs.id
       limit 1`,
      [ownerKind, ownerId],
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      sectionId: String(row.section_id),
      sectionLabel: String(row.label),
      courseId: String(row.course_id),
      courseCode: String(row.code),
      courseTitle: String(row.title),
      term: String(row.term),
      joinedAt: iso(row.joined_at),
    } satisfies StudentSectionDto;
  }

  async function getSectionReleases(sectionId: string) {
    const rows = await readRows<Record<string, unknown>>(
      query,
      `select
         sqa.question_id,
         sqa.released_version_id,
         qv.version_number,
         sqa.position,
         coalesce(qv.snapshot_json ->> 'topicId', q.topic_id) as topic_id,
         ct.position as topic_position,
         coalesce(sta.state, 'closed') as topic_state,
         sta.opens_at,
         sqa.attempts_allowed,
         sqa.hints_enabled,
         sqa.solution_reveal
       from section_question_availability sqa
       join course_sections cs on cs.id = sqa.section_id
       join questions q on q.id = sqa.question_id
       join question_versions qv on qv.id = sqa.released_version_id
       left join course_topics ct
         on ct.course_id = cs.course_id
        and ct.topic_id = coalesce(qv.snapshot_json ->> 'topicId', q.topic_id)
       left join section_topic_availability sta
         on sta.section_id = sqa.section_id
        and sta.topic_id = coalesce(qv.snapshot_json ->> 'topicId', q.topic_id)
       where sqa.section_id = $1
         and sqa.state = 'released'
         and q.record_state = 'active'
         and q.published_version_id is not null
       order by ct.position nulls last, sqa.position, sqa.question_id`,
      [sectionId],
    );
    return rows.map<SectionReleaseDto>((row) => ({
      questionId: String(row.question_id),
      questionVersionId: toInt(row.released_version_id),
      releasedVersion: toInt(row.version_number),
      position: toInt(row.position),
      topicId: String(row.topic_id),
      topicPosition:
        row.topic_position === null || row.topic_position === undefined
          ? Number.MAX_SAFE_INTEGER
          : toInt(row.topic_position),
      topicState: row.topic_state as TopicAvailabilityState,
      ...(row.opens_at ? { opensAt: iso(row.opens_at) } : {}),
      delivery: {
        attemptsAllowed: toInt(row.attempts_allowed, 3),
        hintsEnabled: Boolean(row.hints_enabled),
        solutionReveal: row.solution_reveal as SolutionRevealPolicy,
      },
    }));
  }

  return {
    loadProfessorState,
    applyProfessorAction,
    joinSection,
    leaveSection,
    getStudentSection,
    getSectionReleases,
  };
}

// ---------------------------------------------------------------------------
// Demo repository (process memory)
// ---------------------------------------------------------------------------

/** The first seeded copy, before any professor has claimed it. */
const UNCLAIMED_DEMO_KEY = "\u0000demo";

type DemoMembership = {
  professorKey: string;
  sectionId: string;
  courseId: string;
  ownerKind: "user" | "anonymous";
  ownerId: string;
  studentKey: string;
  joinedAt: string;
  leftAt: string | null;
};

/**
 * Process-memory courses for the demo operating modes. Each professor gets
 * their own copy of the deterministic seed on first use, and the browser's
 * demo affordances (Reset, publish, add draft) keep working. Student joins
 * resolve a code against every seeded copy; the printed demo codes work even
 * before any professor has opened the courses screens.
 */
export function createDemoCoursesRepository(): CoursesRepository {
  const states = new Map<string, CoursesState>();
  let memberships: DemoMembership[] = [];

  function seeded() {
    return { ...createSeedState(), activeCourseId: null };
  }

  function stateFor(professorUserId: string) {
    let state = states.get(professorUserId);
    if (!state) {
      const unclaimed = states.get(UNCLAIMED_DEMO_KEY);
      if (unclaimed) {
        states.delete(UNCLAIMED_DEMO_KEY);
        memberships = memberships.map((membership) =>
          membership.professorKey === UNCLAIMED_DEMO_KEY
            ? { ...membership, professorKey: professorUserId }
            : membership,
        );
        state = unclaimed;
      } else {
        state = seeded();
      }
      states.set(professorUserId, state);
    }
    return state;
  }

  function findSection(sectionId: string) {
    for (const [professorKey, state] of states) {
      const section = state.sections.find(
        (candidate) => candidate.id === sectionId,
      );
      if (section) return { professorKey, section, state };
    }
    return undefined;
  }

  function dto(state: CoursesState, membership: DemoMembership) {
    const section = state.sections.find(
      (candidate) => candidate.id === membership.sectionId,
    );
    const course = state.courses.find(
      (candidate) => candidate.id === membership.courseId,
    );
    if (
      !section ||
      !course ||
      section.status !== "active" ||
      course.status !== "active"
    ) {
      return undefined;
    }
    return {
      sectionId: section.id,
      sectionLabel: section.label,
      courseId: course.id,
      courseCode: course.code,
      courseTitle: course.title,
      term: course.term,
      joinedAt: membership.joinedAt,
    } satisfies StudentSectionDto;
  }

  function removeMember(membership: DemoMembership) {
    const state = states.get(membership.professorKey);
    if (!state) return;
    states.set(membership.professorKey, {
      ...state,
      members: state.members.filter(
        (member) =>
          member.sectionId !== membership.sectionId ||
          member.studentKey !== membership.studentKey,
      ),
    });
  }

  return {
    async loadProfessorState(professorUserId) {
      return { ...stateFor(professorUserId), activeCourseId: null };
    },

    async applyProfessorAction(professorUserId, action) {
      if (!action || typeof action !== "object") {
        throw new CoursesValidationError("Unknown action.");
      }
      if (action.type === "hydrate" || action.type === "course/setActive") {
        throw new CoursesValidationError(
          `${action.type} is not available for saved courses.`,
        );
      }
      const before = stateFor(professorUserId);
      if (action.type === "reset") {
        memberships = memberships.filter(
          (membership) => membership.professorKey !== professorUserId,
        );
        states.set(professorUserId, seeded());
        return { ...stateFor(professorUserId), activeCourseId: null };
      }
      const after = coursesReducer(before, action);
      states.set(professorUserId, { ...after, activeCourseId: null });
      return { ...after, activeCourseId: null };
    },

    async joinSection(owner, rawCode) {
      assertOwner(owner);
      const joinCode = normalizeJoinCode(rawCode);
      if (!JOIN_CODE_PATTERN.test(joinCode)) {
        throw new CoursesNotFoundError("We don't recognise that code.");
      }
      if (states.size === 0) states.set(UNCLAIMED_DEMO_KEY, seeded());
      let match:
        | { professorKey: string; section: CourseSection; state: CoursesState }
        | undefined;
      for (const [professorKey, state] of states) {
        const section = state.sections.find(
          (candidate) => candidate.joinCode === joinCode,
        );
        const course = section
          ? state.courses.find((candidate) => candidate.id === section.courseId)
          : undefined;
        if (
          section &&
          course &&
          section.status === "active" &&
          course.status === "active"
        ) {
          match = { professorKey, section, state };
          break;
        }
      }
      if (!match) {
        throw new CoursesNotFoundError("We don't recognise that code.");
      }
      const [ownerKind, ownerId] = ownerColumns(owner);
      const studentKey = studentKeyForOwner(owner);
      const sameOwner = (membership: DemoMembership) =>
        membership.ownerKind === ownerKind && membership.ownerId === ownerId;
      const current = memberships.find(
        (membership) =>
          sameOwner(membership) &&
          membership.leftAt === null &&
          membership.professorKey === match.professorKey &&
          membership.sectionId === match.section.id,
      );
      if (current) {
        return dto(match.state, current) as StudentSectionDto;
      }
      const now = new Date().toISOString();
      for (const membership of memberships) {
        if (
          sameOwner(membership) &&
          membership.leftAt === null &&
          membership.professorKey === match.professorKey &&
          membership.courseId === match.section.courseId
        ) {
          membership.leftAt = now;
          removeMember(membership);
        }
      }
      const membership: DemoMembership = {
        professorKey: match.professorKey,
        sectionId: match.section.id,
        courseId: match.section.courseId,
        ownerKind,
        ownerId,
        studentKey,
        joinedAt: now,
        leftAt: null,
      };
      memberships.push(membership);
      const state = states.get(match.professorKey) as CoursesState;
      states.set(match.professorKey, {
        ...state,
        members: [
          ...state.members.filter(
            (member) =>
              member.sectionId !== membership.sectionId ||
              member.studentKey !== studentKey,
          ),
          {
            sectionId: membership.sectionId,
            studentKey,
            joinedAt: now,
            lastActiveAt: now,
            sessions: 0,
            attempts: 0,
            correctAttempts: 0,
            hintsUsed: 0,
            attentionNote: null,
            topicMastery: {},
          },
        ],
      });
      return dto(match.state, membership) as StudentSectionDto;
    },

    async leaveSection(owner) {
      assertOwner(owner);
      const [ownerKind, ownerId] = ownerColumns(owner);
      const now = new Date().toISOString();
      for (const membership of memberships) {
        if (
          membership.ownerKind === ownerKind &&
          membership.ownerId === ownerId &&
          membership.leftAt === null
        ) {
          membership.leftAt = now;
          removeMember(membership);
        }
      }
    },

    async getStudentSection(owner) {
      assertOwner(owner);
      const [ownerKind, ownerId] = ownerColumns(owner);
      const active = memberships
        .filter(
          (membership) =>
            membership.ownerKind === ownerKind &&
            membership.ownerId === ownerId &&
            membership.leftAt === null,
        )
        .sort((left, right) => right.joinedAt.localeCompare(left.joinedAt));
      for (const membership of active) {
        const state = states.get(membership.professorKey);
        const section = state ? dto(state, membership) : undefined;
        if (section) return section;
      }
      return undefined;
    },

    async getSectionReleases(sectionId) {
      const found = findSection(sectionId);
      if (!found) return [];
      const { section, state } = found;
      const bank = new Map(
        state.bank.map((question) => [question.id, question]),
      );
      const topicPosition = new Map(
        state.courseTopics
          .filter((row) => row.courseId === section.courseId)
          .map((row) => [row.topicId, row.position]),
      );
      const topicRows = new Map(
        state.topicAvailability
          .filter((row) => row.sectionId === sectionId)
          .map((row) => [row.topicId, row]),
      );
      return state.questionAvailability
        .filter(
          (row) =>
            row.sectionId === sectionId &&
            row.state === "released" &&
            row.releasedVersion !== null &&
            bank.get(row.questionId)?.state === "published",
        )
        .map<SectionReleaseDto>((row) => {
          const question = bank.get(row.questionId) as BankQuestion;
          const topic = topicRows.get(question.topicId);
          return {
            questionId: row.questionId,
            // The demo has no version table: the version number stands in.
            questionVersionId: row.releasedVersion as number,
            releasedVersion: row.releasedVersion as number,
            position: row.position,
            topicId: question.topicId,
            topicPosition:
              topicPosition.get(question.topicId) ?? Number.MAX_SAFE_INTEGER,
            topicState: topic?.state ?? "closed",
            ...(topic?.opensAt ? { opensAt: topic.opensAt } : {}),
            delivery: { ...row.delivery },
          };
        })
        .sort(
          (left, right) =>
            left.topicPosition - right.topicPosition ||
            left.position - right.position ||
            left.questionId.localeCompare(right.questionId),
        );
    },
  };
}

const STUDENT_PINNED_GENERATED_SOURCES = new Set([
  "generated_original",
  "pattern_derived_original",
]);

/**
 * One question version's student content, only when it is this student's
 * section pin: an active membership (left_at null) of an active section in an
 * active course releases this question at exactly this version, and the
 * question is still published (the same rule the tutor-session guard in
 * migration 029 enforces). Anything else reads as `undefined`.
 *
 * A pinned version that a newer publication replaced is `unpublished` in the
 * lifecycle, so the content view reports it as private; the section release
 * is what makes it student-facing, so it is mapped as the published content
 * it was when the professor released it.
 */
export async function readStudentQuestionVersion(
  query: DatabaseQueryExecutor,
  owner: StudentOwner,
  questionId: string,
  questionVersionId: number,
): Promise<TutorQuestion | undefined> {
  assertOwner(owner);
  if (!Number.isSafeInteger(questionVersionId) || questionVersionId <= 0) {
    return undefined;
  }
  const [ownerKind, ownerId] = ownerColumns(owner);
  const rows = await readRows<Record<string, unknown>>(
    query,
    `select qvc.*
     from app_question_version_content qvc
     join topics t on t.id = qvc.topic_id and t.is_active = true
     where qvc.id = $1
       and qvc.question_version_id = $2
       and qvc.record_state = 'active'
       and qvc.published_version_id is not null
       and qvc.lifecycle_state in ('published', 'unpublished')
       and exists (
         select 1
         from section_question_availability sqa
         join section_members m
           on m.section_id = sqa.section_id
          and m.left_at is null
         join course_sections cs
           on cs.id = sqa.section_id
          and cs.status = 'active'
         join courses c
           on c.id = cs.course_id
          and c.status = 'active'
         where sqa.question_id = qvc.id
           and sqa.state = 'released'
           and sqa.released_version_id = qvc.question_version_id
           and m.owner_kind = $3
           and m.owner_id = $4
       )
     limit 1`,
    [questionId, questionVersionId, ownerKind, ownerId],
  );
  const row = rows[0];
  if (!row) return undefined;
  const question = mapQuestionRow(row as Parameters<typeof mapQuestionRow>[0]);
  return {
    ...question,
    source: {
      ...question.source,
      trustLevel: STUDENT_PINNED_GENERATED_SOURCES.has(
        question.source.sourceType,
      )
        ? "professor_approved"
        : question.source.trustLevel,
      visibility: "public",
    },
    review: { ...question.review, status: "approved" },
  };
}
