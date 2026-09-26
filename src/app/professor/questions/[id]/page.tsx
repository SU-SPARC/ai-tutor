import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { QuestionReleaseRail } from "@/components/courses/question-release-rail";
import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { ProfessorQuestionDetailSummary } from "@/components/professor/professor-question-detail-summary";
import { ProfessorQuestionLifecyclePanel } from "@/components/professor/professor-question-lifecycle-panel";
import { ProfessorQuestionSimilarityControls } from "@/components/professor/professor-question-similarity-controls";
import { ProfessorQuestionSimilarityCoverage } from "@/components/professor/professor-question-similarity-coverage";
import { Button } from "@/components/ui/button";
import {
  requirePageAccess,
  requireProfessorReview,
} from "@/lib/auth/authorization";
import { getQuestionLifecycleDashboard } from "@/lib/data/data-store";
import {
  listQuestionSimilarityCoverage,
  listQuestionSimilarityLinks,
} from "@/lib/data/question-similarity-repository";
import {
  isProfessorQuestionId,
  professorReviewQueuePagePath,
} from "@/lib/professor/question-paths";

export const metadata: Metadata = {
  title: "Question",
};

/**
 * One question's lifecycle: its current fields, where it stands, and every
 * attributed action available to the professor. This is where "View draft"
 * lands after a save from the AI question intake screen.
 */
export default async function ProfessorQuestionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const questionId = safeDecode(id ?? "").trim();
  const authorization = await requirePageAccess(
    requireProfessorReview,
    `/professor/questions/${encodeURIComponent(questionId)}`,
  );

  // Hand-typed URLs never reach a query: only well-formed stable IDs continue.
  if (!isProfessorQuestionId(questionId)) {
    notFound();
  }

  const dashboard = await getQuestionLifecycleDashboard(authorization);
  const question = dashboard.questions.find(
    (candidate) => candidate.questionId === questionId,
  );
  if (!question) {
    notFound();
  }
  const [similarityLinks, similarityCoverage] = await Promise.all([
    listQuestionSimilarityLinks(authorization, questionId),
    listQuestionSimilarityCoverage(
      authorization,
      question.workingVersion.topicId,
    ),
  ]);

  const topicTitle = dashboard.topics.find(
    (topic) => topic.id === question.workingVersion.topicId,
  )?.title;
  const working = question.workingVersion;
  const inReviewQueue =
    working.state === "needs_review" && question.recordState === "active";

  return (
    <ProfessorPageShell
      title={working.title}
      breadcrumbs={[
        { label: "Workspace", href: "/professor" },
        { label: "Questions", href: "/professor/questions" },
        { label: working.title },
      ]}
      description={`${topicTitle ?? working.topicId} · version ${working.versionNumber} of ${question.versions.length}; students only ever see a published version.`}
      notice={
        dashboard.readOnly
          ? (dashboard.readOnlyReason ??
            "Demo mode is read-only: nothing here can be changed.")
          : undefined
      }
      aside={
        inReviewQueue ? (
          <Button asChild>
            <Link
              href={professorReviewQueuePagePath(
                working.topicId,
                question.questionId,
              )}
            >
              Open in review queue
            </Link>
          </Button>
        ) : undefined
      }
    >
      <div className="grid gap-8 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-8 lg:col-span-2">
          <ProfessorQuestionDetailSummary
            question={question}
            topicTitle={topicTitle}
          />
          <ProfessorQuestionSimilarityControls
            initialLinks={similarityLinks}
            publishedOrigins={dashboard.questions.flatMap((candidate) =>
              candidate.publishedVersion && candidate.recordState === "active"
                ? [
                    {
                      questionId: candidate.questionId,
                      title: candidate.publishedVersion.title,
                      versionId: candidate.publishedVersion.versionId,
                    },
                  ]
                : [],
            )}
            question={question}
          />
          <ProfessorQuestionSimilarityCoverage
            coverage={similarityCoverage}
            topicTitle={topicTitle ?? working.topicId}
          />
          <section
            aria-labelledby="question-lifecycle-heading"
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-1">
              <h2 id="question-lifecycle-heading" className="type-h2 text-ink">
                Versions and actions
              </h2>
              <p className="type-small max-w-prose text-ink-muted">
                Every action is recorded against your account. Editing creates
                a new draft version; the published version stays as it is until
                you publish again.
              </p>
            </div>
            <ProfessorQuestionLifecyclePanel
              focusQuestionId={question.questionId}
              hideBulkControls
              initialDashboard={{ ...dashboard, questions: [question] }}
            />
          </section>
        </div>
        {/* Publishing a version does not move a section to it; the rail is
            where that gap becomes visible. */}
        <div className="lg:sticky lg:top-[calc(var(--header-h)+1rem)] lg:self-start">
          <QuestionReleaseRail questionId={question.questionId} />
        </div>
      </div>
    </ProfessorPageShell>
  );
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}
