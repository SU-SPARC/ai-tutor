/**
 * Course identity shared by server and client code. The `courses` table
 * (migration 028) is the source of truth at runtime; these constants are the
 * ids the platform itself refers to.
 */

export const PROBABILITY_STATISTICS_COURSE_ID = "probability-statistics";
export const CALCULUS_COURSE_ID = "calculus-1";

/** The course a student sees until they choose another one. */
export const DEFAULT_COURSE_ID = PROBABILITY_STATISTICS_COURSE_ID;

/** Cookie that remembers the student's (or professor's) working course. */
export const COURSE_SELECTION_COOKIE = "ai-tutor-course";

const COURSE_ID_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type PlatformCourse = {
  active: boolean;
  /** Institutional course code when one has been provided; null otherwise. */
  code: string | null;
  id: string;
  order: number;
  title: string;
};

/**
 * The courses registered by migration 028, used by the demo (no database)
 * repository and as the fallback when a caller needs ordering information
 * without a database read.
 */
export const DEFAULT_PLATFORM_COURSES: readonly PlatformCourse[] = [
  {
    active: true,
    code: "MATH-255",
    id: PROBABILITY_STATISTICS_COURSE_ID,
    order: 1,
    title: "Probability & Statistics",
  },
  {
    active: true,
    code: null,
    id: CALCULUS_COURSE_ID,
    order: 2,
    title: "Calculus I",
  },
];

export function isCourseIdShape(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    COURSE_ID_SHAPE.test(value)
  );
}

/**
 * Picks the course to show. An unknown, malformed, or inactive selection falls
 * back to the default course, then to the first active course, so a stale
 * cookie can never produce an empty or broken page.
 */
export function resolveCourseId(
  requested: string | null | undefined,
  courses: readonly PlatformCourse[],
): string {
  const active = courses.filter((course) => course.active);
  if (requested && active.some((course) => course.id === requested)) {
    return requested;
  }
  if (active.some((course) => course.id === DEFAULT_COURSE_ID)) {
    return DEFAULT_COURSE_ID;
  }
  return active[0]?.id ?? DEFAULT_COURSE_ID;
}
