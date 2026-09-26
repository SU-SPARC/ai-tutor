import { notFound } from "next/navigation";

import { SectionScreen } from "@/components/courses/section-screen";
import { isCourseEntityId } from "@/lib/courses/paths";

export const metadata = {
  title: "Section",
};

/**
 * One section: who joined, how they are doing, and the settings that govern the
 * join code. Availability lives on the course's topic builder, not here.
 */
export default async function ProfessorCourseSectionPage({
  params,
}: {
  params: Promise<{ id: string; sid: string }>;
}) {
  const { id, sid } = await params;
  if (!isCourseEntityId(id) || !isCourseEntityId(sid)) {
    notFound();
  }
  return <SectionScreen courseId={id} sectionId={sid} />;
}
