import { notFound } from "next/navigation";

import { TopicsBuilderScreen } from "@/components/courses/topics-builder-screen";
import { isCourseEntityId } from "@/lib/courses/paths";

export const metadata = {
  title: "Choose questions",
};

/**
 * S3. Course state is loaded by the client store, so the page only
 * validates the ID's shape; whether that course exists is the client's answer.
 */
export default async function ProfessorCourseTopicsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isCourseEntityId(id)) {
    notFound();
  }
  return <TopicsBuilderScreen courseId={id} />;
}
