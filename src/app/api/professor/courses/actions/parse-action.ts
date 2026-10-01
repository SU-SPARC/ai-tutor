import type { CoursesAction } from "@/lib/courses/reducer";
import { isCourseEntityId } from "@/lib/courses/paths";
import type {
  AnswerType,
  Difficulty,
  SolutionRevealPolicy,
  StagedReleaseChange,
  TopicAvailabilityState,
} from "@/lib/courses/types";

/**
 * Turns an untrusted request body into one `CoursesAction`, or a plain reason
 * it is not one. Every action type has its own whitelist: unknown fields are
 * dropped, ids are trimmed strings, text is length-bounded, and nested objects
 * are rebuilt field by field rather than passed through. `now` is never taken
 * from the client; the server stamps it. `hydrate` (a whole client state) is
 * never accepted. Whether an action is allowed at all in this mode (reset and
 * the bank/* actions are demo-only, course/setActive is client-only) is the
 * repository's decision, not this parser's.
 */
export type ParsedCoursesAction =
  | { ok: true; action: CoursesAction }
  | { ok: false; error: string };

const MAX_ID_LENGTH = 200;
const MAX_RELEASE_CHANGES = 500;
const MAX_LIST_ITEMS = 20;
const MAX_LIST_ITEM_LENGTH = 2_000;
const MAX_PROMPT_LENGTH = 8_000;

class InvalidAction extends Error {}

type Fields = Record<string, unknown>;

export function parseCoursesAction(
  body: unknown,
  now: string,
): ParsedCoursesAction {
  if (!isRecord(body) || !isRecord(body.action)) {
    return { ok: false, error: "Send { action: { type, ... } }." };
  }
  try {
    return { ok: true, action: parseAction(body.action, now) };
  } catch (cause) {
    if (cause instanceof InvalidAction) {
      return { ok: false, error: cause.message };
    }
    throw cause;
  }
}

function parseAction(raw: Fields, now: string): CoursesAction {
  switch (raw.type) {
    case "course/create": {
      const course = record(raw.course, "course");
      const status = optionalEnum(
        course.status,
        ["active", "archived"],
        "course.status",
      );
      return {
        type: "course/create",
        course: {
          id: entityId(course.id, "course.id"),
          code: text(course.code, "course.code", 2, 32),
          title: text(course.title, "course.title", 1, 120),
          term: text(course.term, "course.term", 1, 40),
          status: status ?? "active",
        },
        includeAllTopics: optionalBoolean(
          raw.includeAllTopics,
          "includeAllTopics",
        ),
        now,
      };
    }
    case "course/clone": {
      const newCourse = record(raw.newCourse, "newCourse");
      return {
        type: "course/clone",
        sourceCourseId: entityId(raw.sourceCourseId, "sourceCourseId"),
        newCourse: {
          id: entityId(newCourse.id, "newCourse.id"),
          code: text(newCourse.code, "newCourse.code", 2, 32),
          title: text(newCourse.title, "newCourse.title", 1, 120),
          term: text(newCourse.term, "newCourse.term", 1, 40),
        },
        now,
      };
    }
    case "course/archive":
    case "course/unarchive":
    case "course/setActive":
      return { type: raw.type, courseId: entityId(raw.courseId, "courseId") };
    case "course/updateTopic": {
      const patch = record(raw.patch, "patch");
      const next: { displayLabel?: string | null; included?: boolean } = {};
      if (patch.displayLabel !== undefined) {
        next.displayLabel =
          patch.displayLabel === null ||
          (typeof patch.displayLabel === "string" && !patch.displayLabel.trim())
            ? null
            : text(patch.displayLabel, "patch.displayLabel", 1, 120);
      }
      const included = optionalBoolean(patch.included, "patch.included");
      if (included !== undefined) next.included = included;
      requireNonEmptyPatch(next);
      return {
        type: "course/updateTopic",
        courseId: entityId(raw.courseId, "courseId"),
        topicId: id(raw.topicId, "topicId"),
        patch: next,
      };
    }
    case "course/moveTopic":
      return {
        type: "course/moveTopic",
        courseId: entityId(raw.courseId, "courseId"),
        topicId: id(raw.topicId, "topicId"),
        direction: direction(raw.direction),
      };
    case "section/create": {
      const section = record(raw.section, "section");
      return {
        type: "section/create",
        section: {
          id: entityId(section.id, "section.id"),
          courseId: entityId(section.courseId, "section.courseId"),
          label: text(section.label, "section.label", 1, 60),
          meetingTime:
            optionalText(section.meetingTime, "section.meetingTime", 120) ?? "",
        },
        now,
      };
    }
    case "section/regenerateJoinCode":
      return {
        type: "section/regenerateJoinCode",
        sectionId: entityId(raw.sectionId, "sectionId"),
      };
    case "section/update": {
      const patch = record(raw.patch, "patch");
      const next: {
        label?: string;
        meetingTime?: string;
        status?: "active" | "archived";
      } = {};
      if (patch.label !== undefined)
        next.label = text(patch.label, "patch.label", 1, 60);
      if (patch.meetingTime !== undefined) {
        next.meetingTime =
          optionalText(patch.meetingTime, "patch.meetingTime", 120) ?? "";
      }
      const status = optionalEnum(
        patch.status,
        ["active", "archived"],
        "patch.status",
      );
      if (status) next.status = status;
      requireNonEmptyPatch(next);
      return {
        type: "section/update",
        sectionId: entityId(raw.sectionId, "sectionId"),
        patch: next,
      };
    }
    case "section/setTopicState": {
      const state = requiredEnum<TopicAvailabilityState>(
        raw.state,
        ["open", "closed", "scheduled"],
        "state",
      );
      const opensAt =
        state === "scheduled" ? timestamp(raw.opensAt, "opensAt") : null;
      return {
        type: "section/setTopicState",
        sectionId: entityId(raw.sectionId, "sectionId"),
        topicId: id(raw.topicId, "topicId"),
        state,
        opensAt,
      };
    }
    case "section/applyReleaseChanges": {
      if (!Array.isArray(raw.changes) || raw.changes.length === 0) {
        throw new InvalidAction("changes must be a non-empty list.");
      }
      if (raw.changes.length > MAX_RELEASE_CHANGES) {
        throw new InvalidAction(
          `Apply at most ${MAX_RELEASE_CHANGES} changes at once.`,
        );
      }
      const changes: StagedReleaseChange[] = raw.changes.map((value, index) => {
        const change = record(value, `changes[${index}]`);
        return {
          kind: requiredEnum(
            change.kind,
            ["add", "remove"],
            `changes[${index}].kind`,
          ),
          questionId: id(change.questionId, `changes[${index}].questionId`),
        };
      });
      return {
        type: "section/applyReleaseChanges",
        sectionId: entityId(raw.sectionId, "sectionId"),
        changes,
        now,
      };
    }
    case "section/moveReleased":
      return {
        type: "section/moveReleased",
        sectionId: entityId(raw.sectionId, "sectionId"),
        questionId: id(raw.questionId, "questionId"),
        direction: direction(raw.direction),
      };
    case "section/updateDelivery": {
      const patch = record(raw.patch, "patch");
      const next: {
        attemptsAllowed?: number;
        hintsEnabled?: boolean;
        solutionReveal?: SolutionRevealPolicy;
      } = {};
      if (patch.attemptsAllowed !== undefined) {
        next.attemptsAllowed = integer(
          patch.attemptsAllowed,
          "patch.attemptsAllowed",
          1,
          10,
        );
      }
      const hintsEnabled = optionalBoolean(
        patch.hintsEnabled,
        "patch.hintsEnabled",
      );
      if (hintsEnabled !== undefined) next.hintsEnabled = hintsEnabled;
      const solutionReveal = optionalEnum<SolutionRevealPolicy>(
        patch.solutionReveal,
        ["never", "after_2_wrong", "after_3_wrong", "after_correct"],
        "patch.solutionReveal",
      );
      if (solutionReveal) next.solutionReveal = solutionReveal;
      requireNonEmptyPatch(next);
      return {
        type: "section/updateDelivery",
        sectionId: entityId(raw.sectionId, "sectionId"),
        questionId: id(raw.questionId, "questionId"),
        patch: next,
      };
    }
    case "section/moveToVersion":
      return {
        type: "section/moveToVersion",
        sectionId: entityId(raw.sectionId, "sectionId"),
        questionId: id(raw.questionId, "questionId"),
        version: integer(raw.version, "version", 1, 1_000_000),
      };
    case "reset":
      return { type: "reset" };
    case "bank/publish":
      return {
        type: "bank/publish",
        questionId: id(raw.questionId, "questionId"),
        now,
      };
    case "bank/addDraft": {
      const question = record(raw.question, "question");
      return {
        type: "bank/addDraft",
        question: {
          id: entityId(question.id, "question.id"),
          topicId: id(question.topicId, "question.topicId"),
          title: text(question.title, "question.title", 1, 200),
          prompt: text(
            question.prompt,
            "question.prompt",
            1,
            MAX_PROMPT_LENGTH,
          ),
          answerType: requiredEnum<AnswerType>(
            question.answerType,
            ["numeric", "categorical", "expression"],
            "question.answerType",
          ),
          difficulty: requiredEnum<Difficulty>(
            question.difficulty,
            ["foundational", "core", "challenge"],
            "question.difficulty",
          ),
          finalAnswer: text(
            question.finalAnswer,
            "question.finalAnswer",
            1,
            500,
          ),
          hints: textList(question.hints, "question.hints"),
          solutionSteps: textList(
            question.solutionSteps,
            "question.solutionSteps",
          ),
        },
        now,
      };
    }
    case "hydrate":
      throw new InvalidAction("hydrate is client-only and is never saved.");
    default:
      throw new InvalidAction("Unknown course action type.");
  }
}

function isRecord(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, field: string): Fields {
  if (!isRecord(value)) throw new InvalidAction(`${field} must be an object.`);
  return value;
}

function hasControlCharacters(value: string) {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

function text(value: unknown, field: string, min: number, max: number) {
  if (typeof value !== "string")
    throw new InvalidAction(`${field} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new InvalidAction(`${field} must be ${min}–${max} characters.`);
  }
  if (hasControlCharacters(trimmed)) {
    throw new InvalidAction(
      `${field} contains characters that are not allowed.`,
    );
  }
  return trimmed;
}

function optionalText(value: unknown, field: string, max: number) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && !value.trim()) return "";
  return text(value, field, 1, max);
}

function textList(value: unknown, field: string) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) {
    throw new InvalidAction(
      `${field} must be a list of at most ${MAX_LIST_ITEMS}.`,
    );
  }
  return value.map((item, index) =>
    text(item, `${field}[${index}]`, 1, MAX_LIST_ITEM_LENGTH),
  );
}

function id(value: unknown, field: string) {
  const trimmed = text(value, field, 1, MAX_ID_LENGTH);
  if (/\s/u.test(trimmed))
    throw new InvalidAction(`${field} is not a valid id.`);
  return trimmed;
}

/** Course, section and draft ids end up in URLs, so they keep the slug rule. */
function entityId(value: unknown, field: string) {
  const trimmed = id(value, field);
  if (!isCourseEntityId(trimmed))
    throw new InvalidAction(`${field} is not a valid id.`);
  return trimmed;
}

function optionalBoolean(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean")
    throw new InvalidAction(`${field} must be true or false.`);
  return value;
}

function integer(value: unknown, field: string, min: number, max: number) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new InvalidAction(
      `${field} must be a whole number from ${min} to ${max}.`,
    );
  }
  return value;
}

function requiredEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  const parsed = optionalEnum(value, allowed, field);
  if (!parsed)
    throw new InvalidAction(`${field} must be one of ${allowed.join(", ")}.`);
  return parsed;
}

function optionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
  ) {
    return value as T;
  }
  throw new InvalidAction(`${field} must be one of ${allowed.join(", ")}.`);
}

function direction(value: unknown) {
  return requiredEnum(value, ["up", "down"] as const, "direction");
}

function timestamp(value: unknown, field: string) {
  const raw = text(value, field, 1, 64);
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed))
    throw new InvalidAction(`${field} must be a date and time.`);
  return new Date(parsed).toISOString();
}

function requireNonEmptyPatch(patch: object) {
  if (Object.keys(patch).length === 0) {
    throw new InvalidAction("patch must change at least one allowed field.");
  }
}
