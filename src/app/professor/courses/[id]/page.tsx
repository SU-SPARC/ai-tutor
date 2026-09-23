import { notFound } from "next/navigation";

import { CourseOverviewScreen } from "@/components/courses/course-overview-screen";
import { isCourseEntityId } from "@/lib/courses/paths";

/**
 * S2. The server can only check the shape of the id — whether a course with
 * that id exists is a question for the client store — so a malformed id is a
 * 404 here and an unknown one is a "not in this demo" card inside the shell.
 */
export default async function ProfessorCoursePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isCourseEntityId(id)) {
    notFound();
  }
  return <CourseOverviewScreen courseId={id} />;
}
