/**
 * The only writer of course/section state.
 *
 * Two rules hold everywhere in this file:
 *
 * 1. **It never throws.** The demo store has no server to reconcile with, so a
 *    stale id or a blocked release is a no-op that returns the same state
 *    object. Screens can dispatch optimistically without try/catch.
 * 2. **Approve, publish, release are three separate gates.** Nothing here
 *    releases a question that is not `published`, and releasing never publishes.
 */

import { generateJoinCode } from "@/lib/courses/format";
import { SEED_NOW, createSeedState } from "@/lib/courses/demo-seed";
import {
  DEFAULT_DELIVERY_SETTINGS,
  type BankQuestion,
  type Course,
  type CourseId,
  type CourseSection,
  type CourseStatus,
  type CourseTopic,
  type CoursesState,
  type DeliverySettings,
  type QuestionId,
  type SectionId,
  type SectionQuestionAvailability,
  type StagedReleaseChange,
  type TopicAvailabilityState,
  type TopicId,
} from "@/lib/courses/types";

/**
 * `now` is optional on the creation actions so a screen can dispatch without a
 * clock; it falls back to the seed clock rather than `Date.now()` so the
 * reducer stays pure and server/client renders cannot diverge.
 */
export type CoursesAction =
  | {
      type: "course/create";
      course: Omit<Course, "createdAt">;
      includeAllTopics?: boolean;
      now?: string;
    }
  | {
      type: "course/clone";
      sourceCourseId: CourseId;
      newCourse: { id: CourseId; code: string; title: string; term: string };
      now?: string;
    }
  | { type: "course/archive"; courseId: CourseId }
  | { type: "course/unarchive"; courseId: CourseId }
  | { type: "course/setActive"; courseId: CourseId }
  | {
      type: "course/updateTopic";
      courseId: CourseId;
      topicId: TopicId;
      patch: Partial<Pick<CourseTopic, "displayLabel" | "included">>;
    }
  | {
      type: "course/moveTopic";
      courseId: CourseId;
      topicId: TopicId;
      direction: "up" | "down";
    }
  | {
      type: "section/create";
      section: Omit<CourseSection, "createdAt" | "joinCode" | "status">;
      now?: string;
    }
  | { type: "section/regenerateJoinCode"; sectionId: SectionId }
  | {
      type: "section/update";
      sectionId: SectionId;
      patch: Partial<Pick<CourseSection, "label" | "meetingTime" | "status">>;
    }
  | {
      type: "section/setTopicState";
      sectionId: SectionId;
      topicId: TopicId;
      state: TopicAvailabilityState;
      opensAt?: string | null;
    }
  | {
      type: "section/applyReleaseChanges";
      sectionId: SectionId;
      changes: StagedReleaseChange[];
      now: string;
    }
  | {
      type: "section/moveReleased";
      sectionId: SectionId;
      questionId: QuestionId;
      direction: "up" | "down";
    }
  | {
      type: "section/updateDelivery";
      sectionId: SectionId;
      questionId: QuestionId;
      patch: Partial<DeliverySettings>;
    }
  | {
      type: "section/moveToVersion";
      sectionId: SectionId;
      questionId: QuestionId;
      version: number;
    }
  | { type: "bank/publish"; questionId: QuestionId; now: string }
  | {
      type: "bank/addDraft";
      question: Pick<
        BankQuestion,
        | "id"
        | "topicId"
        | "title"
        | "prompt"
        | "answerType"
        | "difficulty"
        | "finalAnswer"
        | "hints"
        | "solutionSteps"
      >;
      now: string;
    }
  | { type: "reset" }
  /**
   * Internal: the client store swaps in persisted state after mount. Dispatched
   * with no `state` when there was nothing to restore, which still flips the
   * store's `hydrated` flag.
   */
  | { type: "hydrate"; state?: CoursesState };

function sectionNumberSuffix(index: number) {
  return String(index + 1).padStart(2, "0");
}

/** First still-active course, used when archiving the one in the switcher. */
function firstActiveCourseId(courses: Course[], excludeId?: CourseId) {
  return (
    courses.find(
      (course) => course.status === "active" && course.id !== excludeId,
    )?.id ?? null
  );
}

function courseTopicsFor(state: CoursesState, courseId: CourseId) {
  return state.courseTopics
    .filter((row) => row.courseId === courseId)
    .sort((left, right) => left.position - right.position);
}

/** Release rows for one section, in the order the section list shows them. */
function releasedRowsFor(state: CoursesState, sectionId: SectionId) {
  return state.questionAvailability.filter(
    (row) => row.sectionId === sectionId,
  );
}

function withoutPinnedSessions(
  pinnedSessions: CoursesState["pinnedSessions"],
  keys: string[],
) {
  if (keys.length === 0) {
    return pinnedSessions;
  }
  const next = { ...pinnedSessions };
  for (const key of keys) {
    delete next[key];
  }
  return next;
}

export function coursesReducer(
  state: CoursesState,
  action: CoursesAction,
): CoursesState {
  switch (action.type) {
    case "hydrate": {
      return action.state?.schemaVersion === 1 ? action.state : state;
    }

    case "reset": {
      return createSeedState();
    }

    case "course/create": {
      if (state.courses.some((course) => course.id === action.course.id)) {
        return state;
      }
      const createdAt = action.now ?? SEED_NOW;
      const includeAllTopics = action.includeAllTopics ?? true;
      return {
        ...state,
        courses: [...state.courses, { ...action.course, createdAt }],
        courseTopics: [
          ...state.courseTopics,
          ...state.topics.map((topic, position) => ({
            courseId: action.course.id,
            topicId: topic.id,
            position,
            displayLabel: null,
            included: includeAllTopics,
          })),
        ],
      };
    }

    case "course/clone": {
      const source = state.courses.find(
        (course) => course.id === action.sourceCourseId,
      );
      if (!source) {
        return state;
      }
      if (state.courses.some((course) => course.id === action.newCourse.id)) {
        return state;
      }
      const createdAt = action.now ?? SEED_NOW;
      const sourceSections = state.sections.filter(
        (section) => section.courseId === source.id,
      );
      const sectionIdBySource = new Map<SectionId, SectionId>();
      const clonedSections = sourceSections.map((section, index) => {
        const id = `${action.newCourse.id}-sec-${sectionNumberSuffix(index)}`;
        sectionIdBySource.set(section.id, id);
        return {
          id,
          courseId: action.newCourse.id,
          label: section.label,
          meetingTime: section.meetingTime,
          joinCode: generateJoinCode(id),
          status: "active" as const,
          createdAt,
        };
      });

      const clonedTopicAvailability = state.topicAvailability
        .filter((row) => sectionIdBySource.has(row.sectionId))
        .map((row) => ({
          sectionId: sectionIdBySource.get(row.sectionId) as SectionId,
          topicId: row.topicId,
          // A clone opens nothing on its own: the professor re-opens each topic.
          state: "closed" as const,
          opensAt: null,
        }));

      const clonedQuestionAvailability = state.questionAvailability
        .filter((row) => sectionIdBySource.has(row.sectionId))
        .map((row) => ({
          sectionId: sectionIdBySource.get(row.sectionId) as SectionId,
          questionId: row.questionId,
          // Held, not released — nothing reaches a student until re-released.
          state: "held" as const,
          releasedAt: null,
          releasedVersion: row.releasedVersion,
          position: row.position,
          delivery: { ...row.delivery },
        }));

      return {
        ...state,
        courses: [
          ...state.courses,
          { ...action.newCourse, status: "active", createdAt },
        ],
        courseTopics: [
          ...state.courseTopics,
          ...courseTopicsFor(state, source.id).map((row) => ({
            ...row,
            courseId: action.newCourse.id,
          })),
        ],
        sections: [...state.sections, ...clonedSections],
        topicAvailability: [
          ...state.topicAvailability,
          ...clonedTopicAvailability,
        ],
        questionAvailability: [
          ...state.questionAvailability,
          ...clonedQuestionAvailability,
        ],
      };
    }

    case "course/archive":
    case "course/unarchive": {
      const status: CourseStatus =
        action.type === "course/archive" ? "archived" : "active";
      if (
        !state.courses.some(
          (course) => course.id === action.courseId && course.status !== status,
        )
      ) {
        return state;
      }
      const courses = state.courses.map((course) =>
        course.id === action.courseId ? { ...course, status } : course,
      );
      return {
        ...state,
        courses,
        activeCourseId:
          status === "archived" && state.activeCourseId === action.courseId
            ? firstActiveCourseId(courses, action.courseId)
            : state.activeCourseId,
      };
    }

    case "course/setActive": {
      if (!state.courses.some((course) => course.id === action.courseId)) {
        return state;
      }
      return { ...state, activeCourseId: action.courseId };
    }

    case "course/updateTopic": {
      const exists = state.courseTopics.some(
        (row) =>
          row.courseId === action.courseId && row.topicId === action.topicId,
      );
      if (!exists) {
        return state;
      }
      return {
        ...state,
        courseTopics: state.courseTopics.map((row) =>
          row.courseId === action.courseId && row.topicId === action.topicId
            ? { ...row, ...action.patch }
            : row,
        ),
      };
    }

    case "course/moveTopic": {
      const ordered = courseTopicsFor(state, action.courseId);
      const index = ordered.findIndex((row) => row.topicId === action.topicId);
      const target = action.direction === "up" ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= ordered.length) {
        return state;
      }
      const moved = ordered[index];
      const displaced = ordered[target];
      // Positions are normalized to the list index so repeated moves stay stable.
      const positionById = new Map(
        ordered.map((row, rowIndex) => [row.topicId, rowIndex]),
      );
      positionById.set(moved.topicId, target);
      positionById.set(displaced.topicId, index);
      return {
        ...state,
        courseTopics: state.courseTopics.map((row) =>
          row.courseId === action.courseId && positionById.has(row.topicId)
            ? { ...row, position: positionById.get(row.topicId) as number }
            : row,
        ),
      };
    }

    case "section/create": {
      if (state.sections.some((section) => section.id === action.section.id)) {
        return state;
      }
      if (
        !state.courses.some((course) => course.id === action.section.courseId)
      ) {
        return state;
      }
      const createdAt = action.now ?? SEED_NOW;
      const section: CourseSection = {
        ...action.section,
        joinCode: generateJoinCode(action.section.id),
        status: "active",
        createdAt,
      };
      // A new section starts closed on every topic; opening is a deliberate act.
      const topicRows = courseTopicsFor(state, action.section.courseId).map(
        (row) => ({
          sectionId: section.id,
          topicId: row.topicId,
          state: "closed" as const,
          opensAt: null,
        }),
      );
      return {
        ...state,
        sections: [...state.sections, section],
        topicAvailability: [...state.topicAvailability, ...topicRows],
      };
    }

    case "section/regenerateJoinCode": {
      const section = state.sections.find(
        (candidate) => candidate.id === action.sectionId,
      );
      if (!section) {
        return state;
      }
      const used = new Set(
        state.sections.map((candidate) => candidate.joinCode),
      );
      let joinCode = generateJoinCode(`${section.id}:${section.joinCode}`);
      let attempt = 0;
      while (used.has(joinCode) && attempt < 50) {
        attempt += 1;
        joinCode = generateJoinCode(
          `${section.id}:${section.joinCode}#${attempt}`,
        );
      }
      return {
        ...state,
        sections: state.sections.map((candidate) =>
          candidate.id === action.sectionId
            ? { ...candidate, joinCode }
            : candidate,
        ),
      };
    }

    case "section/update": {
      if (!state.sections.some((section) => section.id === action.sectionId)) {
        return state;
      }
      return {
        ...state,
        sections: state.sections.map((section) =>
          section.id === action.sectionId
            ? { ...section, ...action.patch }
            : section,
        ),
      };
    }

    case "section/setTopicState": {
      if (!state.sections.some((section) => section.id === action.sectionId)) {
        return state;
      }
      if (!state.topics.some((topic) => topic.id === action.topicId)) {
        return state;
      }
      const opensAt =
        action.state === "scheduled" ? (action.opensAt ?? null) : null;
      const exists = state.topicAvailability.some(
        (row) =>
          row.sectionId === action.sectionId && row.topicId === action.topicId,
      );
      if (!exists) {
        return {
          ...state,
          topicAvailability: [
            ...state.topicAvailability,
            {
              sectionId: action.sectionId,
              topicId: action.topicId,
              state: action.state,
              opensAt,
            },
          ],
        };
      }
      return {
        ...state,
        topicAvailability: state.topicAvailability.map((row) =>
          row.sectionId === action.sectionId && row.topicId === action.topicId
            ? { ...row, state: action.state, opensAt }
            : row,
        ),
      };
    }

    case "section/applyReleaseChanges": {
      if (!state.sections.some((section) => section.id === action.sectionId)) {
        return state;
      }
      const existing = new Map(
        releasedRowsFor(state, action.sectionId).map((row) => [
          row.questionId,
          row,
        ]),
      );
      const removedIds = new Set<QuestionId>();
      /** Held rows a staged add turns back on, pinned to the current version. */
      const reReleased = new Map<QuestionId, number | null>();
      const added: SectionQuestionAvailability[] = [];
      // Appends land at the end of their topic, so an add never reorders the
      // list a professor already arranged.
      const nextPosition = new Map<TopicId, number>();
      for (const row of existing.values()) {
        const question = state.bank.find(
          (candidate) => candidate.id === row.questionId,
        );
        if (!question) {
          continue;
        }
        nextPosition.set(
          question.topicId,
          Math.max(nextPosition.get(question.topicId) ?? 0, row.position + 1),
        );
      }

      // Removes are resolved first: if the same question is staged both ways,
      // the removal wins, which is the safer reading for students mid-attempt.
      for (const change of action.changes) {
        if (change.kind === "remove" && existing.has(change.questionId)) {
          removedIds.add(change.questionId);
        }
      }

      for (const change of action.changes) {
        if (change.kind !== "add" || removedIds.has(change.questionId)) {
          continue;
        }
        const question = state.bank.find(
          (candidate) => candidate.id === change.questionId,
        );
        // Skip, never throw: a question that lost its published version between
        // staging and applying simply does not go out.
        if (!question || question.state !== "published") {
          continue;
        }
        const current = existing.get(change.questionId);
        if (current) {
          // Already released stays put; a held row is turned back on in place
          // so its position and delivery settings survive.
          if (current.state === "held") {
            reReleased.set(question.id, question.publishedVersion);
          }
          continue;
        }
        if (added.some((row) => row.questionId === question.id)) {
          continue;
        }
        const position = nextPosition.get(question.topicId) ?? 0;
        nextPosition.set(question.topicId, position + 1);
        added.push({
          sectionId: action.sectionId,
          questionId: question.id,
          state: "released",
          releasedAt: action.now,
          releasedVersion: question.publishedVersion,
          position,
          delivery: { ...DEFAULT_DELIVERY_SETTINGS },
        });
      }

      if (
        removedIds.size === 0 &&
        added.length === 0 &&
        reReleased.size === 0
      ) {
        return state;
      }

      return {
        ...state,
        questionAvailability: [
          ...state.questionAvailability
            .filter(
              (row) =>
                row.sectionId !== action.sectionId ||
                !removedIds.has(row.questionId),
            )
            .map((row) =>
              row.sectionId === action.sectionId &&
              reReleased.has(row.questionId)
                ? {
                    ...row,
                    state: "released" as const,
                    releasedAt: action.now,
                    releasedVersion: reReleased.get(row.questionId) ?? null,
                  }
                : row,
            ),
          ...added,
        ],
        pinnedSessions: withoutPinnedSessions(
          state.pinnedSessions,
          [...removedIds].map(
            (questionId) => `${action.sectionId}:${questionId}`,
          ),
        ),
      };
    }

    case "section/moveReleased": {
      const row = state.questionAvailability.find(
        (candidate) =>
          candidate.sectionId === action.sectionId &&
          candidate.questionId === action.questionId,
      );
      const question = state.bank.find(
        (candidate) => candidate.id === action.questionId,
      );
      if (!row || !question) {
        return state;
      }
      const siblings = releasedRowsFor(state, action.sectionId)
        .filter((candidate) => {
          const candidateQuestion = state.bank.find(
            (entry) => entry.id === candidate.questionId,
          );
          return candidateQuestion?.topicId === question.topicId;
        })
        .sort((left, right) => left.position - right.position);
      const index = siblings.findIndex(
        (candidate) => candidate.questionId === action.questionId,
      );
      const target = action.direction === "up" ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= siblings.length) {
        return state;
      }
      const positionById = new Map(
        siblings.map((candidate, candidateIndex) => [
          candidate.questionId,
          candidateIndex,
        ]),
      );
      positionById.set(siblings[index].questionId, target);
      positionById.set(siblings[target].questionId, index);
      return {
        ...state,
        questionAvailability: state.questionAvailability.map((candidate) =>
          candidate.sectionId === action.sectionId &&
          positionById.has(candidate.questionId)
            ? {
                ...candidate,
                position: positionById.get(candidate.questionId) as number,
              }
            : candidate,
        ),
      };
    }

    case "section/updateDelivery": {
      const exists = state.questionAvailability.some(
        (row) =>
          row.sectionId === action.sectionId &&
          row.questionId === action.questionId,
      );
      if (!exists) {
        return state;
      }
      return {
        ...state,
        questionAvailability: state.questionAvailability.map((row) =>
          row.sectionId === action.sectionId &&
          row.questionId === action.questionId
            ? { ...row, delivery: { ...row.delivery, ...action.patch } }
            : row,
        ),
      };
    }

    case "section/moveToVersion": {
      const exists = state.questionAvailability.some(
        (row) =>
          row.sectionId === action.sectionId &&
          row.questionId === action.questionId,
      );
      if (!exists || !Number.isInteger(action.version) || action.version < 1) {
        return state;
      }
      return {
        ...state,
        questionAvailability: state.questionAvailability.map((row) =>
          row.sectionId === action.sectionId &&
          row.questionId === action.questionId
            ? { ...row, releasedVersion: action.version, state: "released" }
            : row,
        ),
      };
    }

    case "bank/publish": {
      const question = state.bank.find(
        (candidate) => candidate.id === action.questionId,
      );
      // Publishing is only reachable from a reviewed state; draft and
      // needs_review must go through review first.
      if (
        !question ||
        (question.state !== "approved" && question.state !== "unpublished")
      ) {
        return state;
      }
      return {
        ...state,
        bank: state.bank.map((candidate) =>
          candidate.id === action.questionId
            ? {
                ...candidate,
                state: "published",
                publishedVersion: candidate.latestVersion,
                updatedAt: action.now,
              }
            : candidate,
        ),
      };
    }

    case "bank/addDraft": {
      if (state.bank.some((candidate) => candidate.id === action.question.id)) {
        return state;
      }
      if (!state.topics.some((topic) => topic.id === action.question.topicId)) {
        return state;
      }
      return {
        ...state,
        bank: [
          ...state.bank,
          {
            ...action.question,
            // Everything a professor writes enters the same review queue.
            state: "needs_review",
            publishedVersion: null,
            latestVersion: 1,
            misconceptions: [],
            tags: [],
            updatedAt: action.now,
          },
        ],
      };
    }

    default: {
      return state;
    }
  }
}
