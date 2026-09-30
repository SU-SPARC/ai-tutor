"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { syncSelectedCourseAction } from "@/app/courses/actions";

/**
 * Rendered by a page that opened on a question or topic from a course other
 * than the remembered one (a direct link). It updates the remembered course in
 * the background and refreshes once, so the header and the next page agree with
 * what is on screen. It renders nothing and never navigates.
 */
export function CourseSelectionSync({ courseId }: { courseId: string }) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    void syncSelectedCourseAction(courseId).then(() => {
      if (!cancelled) {
        router.refresh();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [courseId, router]);

  return null;
}
