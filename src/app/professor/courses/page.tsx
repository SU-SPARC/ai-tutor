import { CoursesIndexScreen } from "@/components/courses/courses-index-screen";

export const metadata = {
  title: "Courses",
};

/**
 * S1. Course state lives in the browser for this demo, so the page itself is a
 * thin frame: the layout has already enforced professor access and mounted the
 * store, and the screen below reads it.
 */
export default function ProfessorCoursesPage() {
  return <CoursesIndexScreen />;
}
