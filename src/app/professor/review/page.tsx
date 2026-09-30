import type { Metadata } from "next";
import Link from "next/link";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { ProfessorCourseFilter } from "@/components/professor/professor-course-filter";
import { getSelectedCourse } from "@/lib/course-selection";
import { ProfessorFriendlyReviewPanel } from "@/components/professor/professor-friendly-review-panel";
import { Button } from "@/components/ui/button";
import { getProfessorQuestionReviewDashboard } from "@/lib/data/data-store";
import {
  requirePageAccess,
  requireProfessorReview,
} from "@/lib/auth/authorization";

export const metadata: Metadata = {
  title: "Review questions",
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
  const { course, courses } = await getSelectedCourse();
  const scope = { courseId: course.id };
  const loaded = await getProfessorQuestionReviewDashboard(
    authorization,
    requestedTopicId,
    scope,
  );
  // Only a real syllabus topic may preselect the queue. Without one, open on
  // the first topic in syllabus order that has questions waiting, so the
  // professor lands on a question instead of an empty chooser.
  const requestedIsRealTopic = loaded.topics.some(
    (topic) => topic.topicId === requestedTopicId,
  );
  const firstWaitingTopicId = [...loaded.topics]
    .sort((left, right) => left.order - right.order)
    .find((topic) => topic.needsReview > 0)?.topicId;
  const preselectedTopicId = requestedIsRealTopic
    ? requestedTopicId
    : firstWaitingTopicId;
  const source =
    preselectedTopicId && preselectedTopicId !== loaded.selectedTopicId
      ? await getProfessorQuestionReviewDashboard(
          authorization,
          preselectedTopicId,
          scope,
        )
      : loaded;
  const dashboard = preselectedTopicId
    ? {
        ...source,
        // A link from "Draft saved" names the question it just created; show
        // that one first so the professor lands on it.
        candidates: [
          ...source.candidates.filter(
            (candidate) => candidate.questionId === requestedQuestionId,
          ),
          ...source.candidates.filter(
            (candidate) => candidate.questionId !== requestedQuestionId,
          ),
        ],
      }
    : { ...source, candidates: [], selectedTopicId: undefined };

  return (
    <ProfessorPageShell
      title="Review questions"
      breadcrumbs={[
        { label: "Home", href: "/professor" },
        { label: "Review questions" },
      ]}
      description="Read each question, then approve it or send it back. Students never see a question until you show it to them."
      notice={
        dashboard.mode === "demo"
          ? "Demo: changes on this page are not saved."
          : undefined
      }
      aside={
        <Button asChild variant="secondary" className="min-h-11">
          <Link href="/professor/questions">Question bank</Link>
        </Button>
      }
      courseFilter={
        <ProfessorCourseFilter
          courses={courses}
          returnTo="/professor/review"
          selectedCourseId={course.id}
        />
      }
    >
      {/* Keyed by topic so following a [Review] link to another topic
          starts the panel fresh on that topic's first question. */}
      <ProfessorFriendlyReviewPanel
        key={preselectedTopicId ?? "no-topic"}
        initialDashboard={dashboard}
        initialTopicId={preselectedTopicId}
      />
    </ProfessorPageShell>
  );
}
