import { redirect } from "next/navigation";

import { isTopicIdShape } from "@/components/learn/learn-model";

export const dynamic = "force-dynamic";

type TopicRedirectProps = {
  params: Promise<{ slug: string }>;
};

/**
 * `/topics/[slug]` moved to `/learn/[topic]`. A slug that could not name a
 * topic lands on the syllabus rather than on a 404 for a page that no longer
 * exists.
 */
export default async function TopicDetailPage({ params }: TopicRedirectProps) {
  const { slug } = await params;
  redirect(isTopicIdShape(slug) ? `/learn/${slug}` : "/learn");
}
