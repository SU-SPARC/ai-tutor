import type { Metadata } from "next";
import Link from "next/link";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { ProfessorFriendlyReviewPanel } from "@/components/professor/professor-friendly-review-panel";
import { Button } from "@/components/ui/button";
import { getProfessorQuestionReviewDashboard } from "@/lib/data/data-store";
import {
  requirePageAccess,
  requireProfessorReview,
} from "@/lib/auth/authorization";

export const metadata: Metadata = {
  title: "Review queue",
};

type ProfessorReviewPageProps = {
  searchParams: Promise<{
    question?: string | string[];
    topic?: string | string[];
  }>;
};

function singleParam(value: string | string[] | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export default async function ProfessorReviewPage({
  searchParams,
}: ProfessorReviewPageProps) {
  const authorization = await requirePageAccess(
    requireProfessorReview,
    "/professor/review",
  );
  const params = await searchParams;
  const requestedTopicId = singleParam(params.topic);
  const requestedQuestionId = singleParam(params.question);
  const loaded = await getProfessorQuestionReviewDashboard(
    authorization,
    requestedTopicId,
  );
  // Only a real syllabus topic may preselect the queue; anything else falls
  // back to the untouched topic chooser.
  const preselectedTopicId = loaded.topics.some(
    (topic) => topic.topicId === requestedTopicId,
  )
    ? requestedTopicId
    : undefined;
  const dashboard = preselectedTopicId
    ? {
        ...loaded,
        // A link from "Draft saved" names the question it just created; show
        // that one first so the professor lands on it.
        candidates: [
          ...loaded.candidates.filter(
            (candidate) => candidate.questionId === requestedQuestionId,
          ),
          ...loaded.candidates.filter(
            (candidate) => candidate.questionId !== requestedQuestionId,
          ),
        ],
      }
    : { ...loaded, candidates: [], selectedTopicId: undefined };
  const waiting = loaded.topics.reduce(
    (sum, topic) => sum + topic.needsReview,
    0,
  );

  return (
    <ProfessorPageShell
      title="Review queue"
      breadcrumbs={[
        { label: "Workspace", href: "/professor" },
        { label: "Review queue" },
      ]}
      description={
        waiting > 0
          ? `${waiting} ${waiting === 1 ? "question waits" : "questions wait"} for a decision; choose a topic to review its questions one at a time.`
          : "Nothing is waiting for a decision; choose a topic to check its queue."
      }
      notice={
        dashboard.mode === "demo"
          ? "Demo data: decisions here are not recorded."
          : undefined
      }
      aside={
        <Button asChild variant="secondary">
          <Link href="/professor/questions">Question bank</Link>
        </Button>
      }
    >
      <ProfessorFriendlyReviewPanel
        initialDashboard={dashboard}
        initialTopicId={preselectedTopicId}
      />
    </ProfessorPageShell>
  );
}
