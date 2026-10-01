"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from "react";

import {
  ACTIVE_COURSE_STORAGE_KEY,
  coursesSyncReducer,
  createInitialCoursesSync,
  saveErrorMessage,
} from "@/components/courses/courses-sync";
import { toast } from "@/components/ui/toast";
import type { CoursesAction } from "@/lib/courses/reducer";
import {
  COURSES_STORAGE_KEY,
  type Course,
  type CourseId,
  type CoursesState,
} from "@/lib/courses/types";

const COURSES_API_PATH = "/api/professor/courses";
const COURSES_ACTIONS_API_PATH = "/api/professor/courses/actions";

export type CoursesStoreValue = {
  state: CoursesState;
  /**
   * Applies the action here at once (the same pure reducer the server runs),
   * then saves it. The server's answer replaces the local state; a rejected
   * save shows its reason in a toast and reloads. `course/setActive` never
   * leaves this browser.
   */
  dispatch: Dispatch<CoursesAction>;
  /** Demo only: put the in-memory demo store back to its seed. */
  reset: () => void;
  /** Load the professor's courses from the server again. */
  reload: () => void;
  /**
   * False on the server and until the first load from the server resolves.
   * Until then `state` is empty, so a screen that looks up an id must render
   * its skeleton, not "not found", while `hydrated` is false. The course
   * overview, topic builder, topic detail and section screens and the
   * header's course switcher gate on it.
   */
  hydrated: boolean;
  /** True when the server is the in-memory demo store (shows Reset). */
  demo: boolean;
  /** True when the last load failed (the screens offer a retry). */
  loadFailed: boolean;
};

const CoursesStoreContext = createContext<CoursesStoreValue | undefined>(
  undefined,
);

/**
 * Holds all course/section state for /professor, backed by
 * GET /api/professor/courses and POST /api/professor/courses/actions.
 */
export function CoursesStoreProvider({ children }: { children: ReactNode }) {
  // The root layout mounts one provider for professors so the header switcher
  // can read it; the /professor layout mounts another for tests that render it
  // alone. A nested provider would fork the state, so an inner one yields.
  const parent = useContext(CoursesStoreContext);
  return parent ? (
    <>{children}</>
  ) : (
    <CoursesStoreRoot>{children}</CoursesStoreRoot>
  );
}

type ResponseBody = { state?: CoursesState; demo?: boolean; error?: unknown };

async function readBody(response: Response): Promise<ResponseBody> {
  try {
    return (await response.json()) as ResponseBody;
  } catch {
    return {};
  }
}

function newRequestId() {
  try {
    return window.crypto.randomUUID();
  } catch {
    return `courses-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function CoursesStoreRoot({ children }: { children: ReactNode }) {
  const [sync, send] = useReducer(
    coursesSyncReducer,
    undefined,
    createInitialCoursesSync,
  );
  const inFlight = useRef<CoursesAction | null>(null);
  const loadGeneration = useRef(0);
  const mounted = useRef(true);

  const reload = useCallback(() => {
    const generation = ++loadGeneration.current;
    void (async () => {
      try {
        const response = await fetch(COURSES_API_PATH, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        const body = await readBody(response);
        if (!mounted.current || generation !== loadGeneration.current) {
          return;
        }
        if (!response.ok || !body.state) {
          send({ type: "loadFailed" });
          toast({ title: "Could not load your courses.", tone: "error" });
          return;
        }
        send({ type: "loaded", state: body.state, demo: body.demo === true });
      } catch {
        if (mounted.current && generation === loadGeneration.current) {
          send({ type: "loadFailed" });
          toast({ title: "Could not load your courses.", tone: "error" });
        }
      }
    })();
  }, []);

  useEffect(() => {
    mounted.current = true;
    let remembered: string | null = null;
    try {
      remembered = window.localStorage.getItem(ACTIVE_COURSE_STORAGE_KEY);
      // The browser-only demo kept the whole state here; it is not read any
      // more, so do not leave stale course data behind.
      window.localStorage.removeItem(COURSES_STORAGE_KEY);
    } catch {
      remembered = null;
    }
    if (remembered) {
      send({ type: "restoreActive", courseId: remembered });
    }
    reload();
    return () => {
      mounted.current = false;
    };
  }, [reload]);

  // Remember the chosen course once there is a real one to remember.
  const activeCourseId = sync.hydrated ? sync.view.activeCourseId : null;
  useEffect(() => {
    if (!activeCourseId) {
      return;
    }
    try {
      window.localStorage.setItem(ACTIVE_COURSE_STORAGE_KEY, activeCourseId);
    } catch {
      // Private mode or a full quota: the choice lasts for this visit only.
    }
  }, [activeCourseId]);

  // Save queued actions one at a time, in order.
  const head = sync.pending[0];
  useEffect(() => {
    if (!head || inFlight.current === head) {
      return;
    }
    inFlight.current = head;
    void (async () => {
      let status: number | undefined;
      let body: ResponseBody = {};
      try {
        const response = await fetch(COURSES_ACTIONS_API_PATH, {
          body: JSON.stringify({ action: head }),
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "Idempotency-Key": newRequestId(),
          },
          method: "POST",
        });
        status = response.status;
        body = await readBody(response);
      } catch {
        status = undefined;
      }
      inFlight.current = null;
      if (!mounted.current) {
        return;
      }
      if (status !== undefined && status >= 200 && status < 300 && body.state) {
        send({ type: "confirmed", state: body.state });
        return;
      }
      send({ type: "rejected" });
      toast({ title: saveErrorMessage(status, body.error), tone: "error" });
      reload();
    })();
  }, [head, reload]);

  const dispatch = useCallback<Dispatch<CoursesAction>>((action) => {
    send({ type: "dispatch", action });
  }, []);

  const reset = useCallback(() => {
    send({ type: "dispatch", action: { type: "reset" } });
  }, []);

  const value = useMemo<CoursesStoreValue>(
    () => ({
      state: sync.view,
      dispatch,
      reset,
      reload,
      hydrated: sync.hydrated,
      demo: sync.demo,
      loadFailed: sync.loadFailed,
    }),
    [
      sync.view,
      sync.hydrated,
      sync.demo,
      sync.loadFailed,
      dispatch,
      reset,
      reload,
    ],
  );

  return (
    <CoursesStoreContext.Provider value={value}>
      {children}
    </CoursesStoreContext.Provider>
  );
}

/**
 * The store, or undefined outside the provider. Use this in components that may
 * be rendered by a shell that is not wrapped (the section nav's course
 * switcher), so a missing provider degrades to rendering nothing.
 */
export function useOptionalCoursesStore(): CoursesStoreValue | undefined {
  return useContext(CoursesStoreContext);
}

export function useCoursesStore(): CoursesStoreValue {
  const value = useContext(CoursesStoreContext);
  if (!value) {
    throw new Error(
      "useCoursesStore must be used inside <CoursesStoreProvider>. The root layout mounts it around the header for professors, and src/app/professor/layout.tsx mounts it around the workspace, so this component is rendering for a student, a signed-out visitor, or a test without the provider. Use useOptionalCoursesStore() where the store may be absent.",
    );
  }
  return value;
}

export type ActiveCourseValue = {
  course: Course | undefined;
  setActiveCourse: (id: CourseId) => void;
};

/** The course every professor tool is currently scoped to. */
export function useActiveCourse(): ActiveCourseValue {
  const { state, dispatch } = useCoursesStore();
  const setActiveCourse = useCallback(
    (id: CourseId) => dispatch({ type: "course/setActive", courseId: id }),
    [dispatch],
  );
  return useMemo(
    () => ({
      course: state.courses.find(
        (candidate) => candidate.id === state.activeCourseId,
      ),
      setActiveCourse,
    }),
    [state.courses, state.activeCourseId, setActiveCourse],
  );
}
