/**
 * The client side of course/section state, as a pure reducer so it can be
 * tested without React.
 *
 * The server owns the data: `server` is the last state it returned. Actions
 * the professor takes are queued in `pending` (oldest first; `pending[0]` is
 * the one being saved) and applied on top of `server` with the same pure
 * `coursesReducer` the server runs, so the screen moves immediately and lands
 * on the same result once the save comes back. A rejected save drops the whole
 * queue, because everything behind it was built on the rejected state; the
 * store then reloads from the server.
 *
 * The one piece of state that never leaves the browser is which course the
 * professor is working in (`course/setActive`); the store keeps it in
 * localStorage under `ACTIVE_COURSE_STORAGE_KEY`.
 */

import { coursesReducer, type CoursesAction } from "@/lib/courses/reducer";
import type { CourseId, CoursesState } from "@/lib/courses/types";

export const ACTIVE_COURSE_STORAGE_KEY = "ai-tutor-courses-active-course";

export type CoursesSyncState = {
  /** Last state the server returned (activeCourseId is always null there). */
  server: CoursesState;
  /** Actions not yet confirmed by the server; `pending[0]` is in flight. */
  pending: CoursesAction[];
  /** The professor's chosen course; client-only. */
  activeCourseId: CourseId | null;
  /** False until the first load from the server resolves. */
  hydrated: boolean;
  /** True when the server said it is the in-memory demo store. */
  demo: boolean;
  /** True after a load failed and before the next one succeeds. */
  loadFailed: boolean;
  /** What the screens render: `server` + `pending` + the active course. */
  view: CoursesState;
};

export type CoursesSyncEvent =
  | { type: "loaded"; state: CoursesState; demo: boolean }
  | { type: "loadFailed" }
  | { type: "dispatch"; action: CoursesAction }
  | { type: "confirmed"; state: CoursesState }
  | { type: "rejected" }
  | { type: "restoreActive"; courseId: CourseId | null };

/** What renders before the first load: nothing, rather than demo data. */
export function createEmptyCoursesState(): CoursesState {
  return {
    schemaVersion: 1,
    activeCourseId: null,
    topics: [],
    bank: [],
    courses: [],
    courseTopics: [],
    sections: [],
    members: [],
    topicAvailability: [],
    questionAvailability: [],
    pinnedSessions: {},
  };
}

export function createInitialCoursesSync(): CoursesSyncState {
  const server = createEmptyCoursesState();
  return {
    server,
    pending: [],
    activeCourseId: null,
    hydrated: false,
    demo: false,
    loadFailed: false,
    view: server,
  };
}

function computeView(
  server: CoursesState,
  pending: CoursesAction[],
  activeCourseId: CourseId | null,
): CoursesState {
  const reduced = pending.reduce(coursesReducer, {
    ...server,
    activeCourseId,
  });
  if (
    reduced.activeCourseId !== null &&
    reduced.courses.some((course) => course.id === reduced.activeCourseId)
  ) {
    return reduced;
  }
  // The remembered course is gone (archived elsewhere, another browser's
  // id, nothing chosen yet): fall back to the first active course.
  const fallback =
    reduced.courses.find((course) => course.status === "active")?.id ?? null;
  return fallback === reduced.activeCourseId
    ? reduced
    : { ...reduced, activeCourseId: fallback };
}

function withView(
  sync: CoursesSyncState,
  patch: Partial<Omit<CoursesSyncState, "view">>,
): CoursesSyncState {
  const next = { ...sync, ...patch };
  return {
    ...next,
    view: computeView(next.server, next.pending, next.activeCourseId),
  };
}

export function coursesSyncReducer(
  sync: CoursesSyncState,
  event: CoursesSyncEvent,
): CoursesSyncState {
  switch (event.type) {
    case "loaded":
      return withView(sync, {
        server: event.state,
        demo: event.demo,
        hydrated: true,
        loadFailed: false,
      });

    case "loadFailed":
      return { ...sync, loadFailed: true };

    case "restoreActive":
      return withView(sync, { activeCourseId: event.courseId });

    case "dispatch": {
      const { action } = event;
      if (action.type === "hydrate") {
        // The server is the only source of state now; nothing to restore.
        return sync;
      }
      if (action.type === "course/setActive") {
        if (
          !sync.view.courses.some((course) => course.id === action.courseId)
        ) {
          return sync;
        }
        return withView(sync, { activeCourseId: action.courseId });
      }
      // The reducer decides what an action does to the active course
      // (archiving it moves to another one; reset restores the demo's).
      const optimistic = coursesReducer(sync.view, action);
      return withView(sync, {
        pending: [...sync.pending, action],
        activeCourseId: optimistic.activeCourseId,
      });
    }

    case "confirmed":
      return withView(sync, {
        server: event.state,
        pending: sync.pending.slice(1),
      });

    case "rejected":
      return withView(sync, { pending: [] });

    default:
      return sync;
  }
}

/** Plain-language reason for a failed save, given the response (if any). */
export function saveErrorMessage(status: number | undefined, error?: unknown) {
  if (
    status !== undefined &&
    status >= 400 &&
    status < 500 &&
    typeof error === "string" &&
    error.trim()
  ) {
    return error.trim();
  }
  return "Could not save, try again";
}
