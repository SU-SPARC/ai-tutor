import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";

import {
  COURSE_SELECTION_COOKIE,
  DEFAULT_PLATFORM_COURSES,
  isCourseIdShape,
  resolveCourseId,
  type PlatformCourse,
} from "@/lib/course-catalog";
import { listCourses, listTopics } from "@/lib/data/data-store";

export type SelectedCourse = {
  course: PlatformCourse;
  courses: PlatformCourse[];
};

/**
 * Every registered course, once per request. If the course list cannot be read
 * the registered defaults stand in: choosing a course must never be the thing
 * that takes a page down, and the page's own content reads still fail loudly.
 */
export const loadCourses = cache(async (): Promise<PlatformCourse[]> => {
  try {
    const courses = await listCourses();
    return courses.length > 0 ? courses : [...DEFAULT_PLATFORM_COURSES];
  } catch {
    return [...DEFAULT_PLATFORM_COURSES];
  }
});

/** The raw cookie value, or undefined outside a request or when unset. */
async function readCourseCookie(): Promise<string | undefined> {
  try {
    const value = (await cookies()).get(COURSE_SELECTION_COOKIE)?.value;
    return isCourseIdShape(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The course this visitor is working in. No cookie, a malformed one, or a
 * course that is unknown or inactive all resolve to the default course, so
 * existing visitors see Probability & Statistics exactly as before.
 */
export async function getSelectedCourse(): Promise<SelectedCourse> {
  const [courses, requested] = await Promise.all([
    loadCourses(),
    readCourseCookie(),
  ]);
  const id = resolveCourseId(requested, courses);
  const course =
    courses.find((candidate) => candidate.id === id) ??
    courses[0] ??
    DEFAULT_PLATFORM_COURSES[0];
  return { course, courses };
}

export async function getSelectedCourseId(): Promise<string> {
  return (await getSelectedCourse()).course.id;
}

/** True when `courseId` names a registered, active course. */
export async function isSelectableCourse(courseId: string): Promise<boolean> {
  if (!isCourseIdShape(courseId)) {
    return false;
  }
  const courses = await loadCourses();
  return courses.some((course) => course.id === courseId && course.active);
}

/**
 * The course a topic belongs to, for deep links that name a question or topic
 * directly. Undefined when the topic is not currently listed.
 */
export async function courseIdForTopic(
  topicId: string,
): Promise<string | undefined> {
  const topics = await listTopics();
  return topics.find((topic) => topic.id === topicId)?.courseId;
}
