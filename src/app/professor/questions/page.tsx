import type { Metadata } from "next";
import Link from "next/link";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { ProfessorQuestionIntakePanel } from "@/components/professor/professor-question-intake-panel";
import { ProfessorQuestionLifecyclePanel } from "@/components/professor/professor-question-lifecycle-panel";
import { professorQuestionsTabFromParam } from "@/components/professor/professor-questions-tab";
import { ProfessorQuestionsTabs } from "@/components/professor/professor-questions-tabs";
import { Button } from "@/components/ui/button";
import { getQuestionLifecycleDashboard } from "@/lib/data/data-store";
import {
  requireProfessorReview,
  requirePageAccess,
} from "@/lib/auth/authorization";

export const metadata: Metadata = {
  title: "Questions",
};

type ProfessorQuestionsPageProps = {
  searchParams: Promise<{
    tab?: string | string[];
    view?: string | string[];
  }>;
};

function singleParam(value: string | string[] | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export default async function ProfessorQuestionsPage({
  searchParams,
}: ProfessorQuestionsPageProps) {
  const authorization = await requirePageAccess(
    requireProfessorReview,
    "/professor/questions",
  );
  const [initialDashboard, params] = await Promise.all([
    getQuestionLifecycleDashboard(authorization),
    searchParams,
  ]);
  const activeQuestions = initialDashboard.questions.filter(
    (question) => question.recordState === "active",
  ).length;

  return (
    <ProfessorPageShell
      title="Questions"
      breadcrumbs={[
        { label: "Workspace", href: "/professor" },
        { label: "Questions" },
      ]}
      description={`${activeQuestions} ${activeQuestions === 1 ? "question" : "questions"} in the bank; every version is immutable and students see only what you publish.`}
      notice={
        initialDashboard.readOnly
          ? (initialDashboard.readOnlyReason ??
            "Demo mode is read-only: nothing here can be changed.")
          : undefined
      }
      aside={
        <Button asChild variant="secondary">
          <Link href="/professor/review">Review queue</Link>
        </Button>
      }
    >
      <ProfessorQuestionsTabs
        defaultTab={professorQuestionsTabFromParam(singleParam(params.tab))}
        bankCount={activeQuestions}
        bank={
          <ProfessorQuestionLifecyclePanel
            initialDashboard={initialDashboard}
            initialView={singleParam(params.view)}
          />
        }
        intake={
          <ProfessorQuestionIntakePanel
            readOnly={initialDashboard.readOnly}
            topics={initialDashboard.topics}
          />
        }
      />
    </ProfessorPageShell>
  );
}
