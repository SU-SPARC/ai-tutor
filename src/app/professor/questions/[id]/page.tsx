import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { QuestionReleaseRail } from "@/components/courses/question-release-rail";
import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import {
  DEMO_NOTICE,
  olderVisibleVersion,
} from "@/components/professor/professor-question-labels";
import { ProfessorQuestionLifecyclePanel } from "@/components/professor/professor-question-lifecycle-panel";
import { ProfessorQuestionSimilarityControls } from "@/components/professor/professor-question-similarity-controls";
import { ProfessorQuestionSimilarityCoverage } from "@/components/professor/professor-question-similarity-coverage";
import {
  requirePageAccess,
  requireProfessorReview,
} from "@/lib/auth/authorization";
import { getQuestionLifecycleDashboard } from "@/lib/data/data-store";
import {
  listQuestionSimilarityCoverage,
  listQuestionSimilarityLinks,
} from "@/lib/data/question-similarity-repository";
import { isProfessorQuestionId } from "@/lib/professor/question-paths";

export const metadata: Metadata = {
  title: "Question",
};

/**
 * One question: where it stands in plain words, at most three buttons, how
 * students see it, and everything rarer under "More options and history".
 * This is where "View draft" lands after a save from the Add a question tab.
 * `?edit=1` opens the editor straight away (the bank's "Edit question").
 */
export default async function ProfessorQuestionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ edit?: string | string[] }>;
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
  const [similarityLinks, similarityCoverage, query] = await Promise.all([
    listQuestionSimilarityLinks(authorization, questionId),
    listQuestionSimilarityCoverage(
      authorization,
      question.workingVersion.topicId,
    ),
    searchParams ?? Promise.resolve<{ edit?: string | string[] }>({}),
  ]);

  const working = question.workingVersion;
  const topicTitle =
    dashboard.topics.find((topic) => topic.id === working.topicId)?.title ??
    working.topicId;
  const older = olderVisibleVersion(question);
  const versionNotice = older
    ? `Students see version ${older.versionNumber}. This preview shows your newer version ${working.versionNumber}.`
    : undefined;
  const notice =
    dashboard.readOnly && versionNotice ? (
      <>
        {DEMO_NOTICE} {versionNotice}
      </>
    ) : dashboard.readOnly ? (
      DEMO_NOTICE
    ) : (
      versionNotice
    );
  const studentsCanSee =
    question.recordState === "active" && Boolean(question.publishedVersion);
  const showsExtraPractice = studentsCanSee || Boolean(question.reserve);

  return (
    <ProfessorPageShell
      title={working.title}
      breadcrumbs={[
        { label: "Home", href: "/professor" },
        { label: "Question bank", href: "/professor/questions" },
        { label: working.title },
      ]}
      description={topicTitle}
      notice={notice}
    >
      <div className="grid gap-8 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-8 lg:col-span-2">
          <ProfessorQuestionLifecyclePanel
            focusQuestionId={question.questionId}
            hideBulkControls
            initialDashboard={{ ...dashboard, questions: [question] }}
            initialEditing={query.edit === "1"}
            moreOptions={
              showsExtraPractice ? (
                <>
                  <ProfessorQuestionSimilarityControls
                    initialLinks={similarityLinks}
                    publishedOrigins={dashboard.questions.flatMap(
                      (candidate) =>
                        candidate.publishedVersion &&
                        candidate.recordState === "active"
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
                  {studentsCanSee ? (
                    <ProfessorQuestionSimilarityCoverage
                      coverage={similarityCoverage}
                      topicTitle={topicTitle}
                    />
                  ) : null}
                </>
              ) : undefined
            }
          />
        </div>
        {/* Showing a version does not move a section to it; the rail is
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
