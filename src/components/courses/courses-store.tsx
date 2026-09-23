"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";

import { createSeedState } from "@/lib/courses/demo-seed";
import { coursesReducer, type CoursesAction } from "@/lib/courses/reducer";
import {
  COURSES_STORAGE_KEY,
  type Course,
  type CourseId,
  type CoursesState,
} from "@/lib/courses/types";

export type CoursesStoreValue = {
  state: CoursesState;
  dispatch: Dispatch<CoursesAction>;
  /** Re-seed the demo and forget what was persisted. */
  reset: () => void;
  /** False until the localStorage read has run; render placeholders until then. */
  hydrated: boolean;
};

const CoursesStoreContext = createContext<CoursesStoreValue | undefined>(
  undefined,
);

/**
 * Only accepts a state that claims the schema this build understands. Anything
 * else (an older demo, hand-edited JSON, a truncated write) is dropped and the
 * seed stands, which is always a working demo.
 */
function parsePersistedState(raw: string | null): CoursesState | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CoursesState>;
    if (
      parsed.schemaVersion !== 1 ||
      !Array.isArray(parsed.topics) ||
      !Array.isArray(parsed.bank) ||
      !Array.isArray(parsed.courses) ||
      !Array.isArray(parsed.sections)
    ) {
      return undefined;
    }
    return parsed as CoursesState;
  } catch {
    return undefined;
  }
}

/**
 * Holds all course/section state for /professor.
 *
 * The initial state is `createSeedState()` on both the server and the client so
 * the first paint matches; the persisted state is swapped in after mount. That
 * is why components read `hydrated` instead of reaching for localStorage.
 */
type StoreState = {
  data: CoursesState;
  hydrated: boolean;
};

/**
 * Wraps the domain reducer with the one piece of state that is about this
 * component rather than about courses: whether the localStorage read has run.
 * Keeping it in the same reducer means hydration is a single render, not a
 * `setState` cascade out of an effect.
 */
function storeReducer(store: StoreState, action: CoursesAction): StoreState {
  const data = coursesReducer(store.data, action);
  const hydrated = store.hydrated || action.type === "hydrate";
  if (data === store.data && hydrated === store.hydrated) {
    return store;
  }
  return { data, hydrated };
}

/**
 * Holds all course/section state for /professor.
 *
 * The initial state is `createSeedState()` on both the server and the client so
 * the first paint matches; the persisted state is swapped in after mount. That
 * is why components read `hydrated` instead of reaching for localStorage.
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

function CoursesStoreRoot({ children }: { children: ReactNode }) {
  const [store, dispatch] = useReducer(storeReducer, undefined, () => ({
    data: createSeedState(),
    hydrated: false,
  }));

  useEffect(() => {
    let persisted: CoursesState | undefined;
    try {
      persisted = parsePersistedState(
        window.localStorage.getItem(COURSES_STORAGE_KEY),
      );
    } catch {
      persisted = undefined;
    }
    dispatch({ type: "hydrate", state: persisted });
  }, []);

  useEffect(() => {
    if (!store.hydrated) {
      return;
    }
    try {
      window.localStorage.setItem(
        COURSES_STORAGE_KEY,
        JSON.stringify(store.data),
      );
    } catch {
      // Private mode or a full quota: the demo keeps working in memory.
    }
  }, [store]);

  const reset = useCallback(() => {
    dispatch({ type: "reset" });
    try {
      window.localStorage.removeItem(COURSES_STORAGE_KEY);
    } catch {
      // Nothing to clear.
    }
  }, []);

  const value = useMemo<CoursesStoreValue>(
    () => ({
      state: store.data,
      dispatch,
      reset,
      hydrated: store.hydrated,
    }),
    [store, reset],
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
      "useCoursesStore must be used inside <CoursesStoreProvider>. It is mounted in src/app/professor/layout.tsx, so this component is rendering outside /professor.",
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
