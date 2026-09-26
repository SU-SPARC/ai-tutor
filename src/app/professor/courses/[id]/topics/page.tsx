import { notFound } from "next/navigation";

import { TopicsBuilderScreen } from "@/components/courses/topics-builder-screen";
import { isCourseEntityId } from "@/lib/courses/paths";

export const metadata = {
  title: "Topic builder",
};

/**
 * S3. Course state lives in the browser for this demo, so the server only
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
