"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { safeReturnPath } from "@/lib/auth/return-path";
import { COURSE_SELECTION_COOKIE } from "@/lib/course-catalog";
import { isSelectableCourse } from "@/lib/course-selection";
import { getServerEnv } from "@/lib/env/server";

const COURSE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

async function rememberCourse(courseId: string) {
  const cookieStore = await cookies();
  cookieStore.set(COURSE_SELECTION_COOKIE, courseId, {
    httpOnly: true,
    maxAge: COURSE_COOKIE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    // Local demos are served over http, where a Secure cookie would be dropped.
    secure: getServerEnv().APP_URL.startsWith("https://"),
  });
}

/**
 * Chooses the course to work in. The choice only changes which course's topics
 * and questions are shown; it never touches progress, which stays with the
 * course it was made in. An unknown or inactive course leaves the current
 * choice alone and returns to the chooser.
 */
export async function selectCourseAction(formData: FormData) {
  const courseId = formData.get("courseId");
  const returnTo = formData.get("returnTo");

  if (typeof courseId !== "string" || !(await isSelectableCourse(courseId))) {
    redirect("/courses");
  }

  await rememberCourse(courseId);
  redirect(safeReturnPath(typeof returnTo === "string" ? returnTo : undefined));
}

/**
 * Keeps the remembered course in step with a question or topic opened by a
 * direct link, so the header and the next page agree with what is on screen.
 * It does not navigate.
 */
export async function syncSelectedCourseAction(courseId: string) {
  if (typeof courseId === "string" && (await isSelectableCourse(courseId))) {
    await rememberCourse(courseId);
  }
}
