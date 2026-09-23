import { notFound } from "next/navigation";

import { TopicDetailScreen } from "@/components/courses/topic-detail-screen";
import { isCourseEntityId } from "@/lib/courses/paths";

/**
 * One topic's question bank inside one course. The ids are validated here —
 * whether they exist is a question only the client store can answer, so the
 * screen renders its own "not in this demo" card for unknown records.
 */
export default async function ProfessorCourseTopicPage({
  params,
}: {
  params: Promise<{ id: string; topicId: string }>;
}) {
  const { id, topicId } = await params;
  if (!isCourseEntityId(id) || !isCourseEntityId(topicId)) {
    notFound();
  }
  return <TopicDetailScreen courseId={id} topicId={topicId} />;
}
