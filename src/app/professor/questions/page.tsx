import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { ProfessorCourseFilter } from "@/components/professor/professor-course-filter";
import { getSelectedCourse } from "@/lib/course-selection";
import {
  DEMO_NOTICE,
  ProfessorQuestionIntakePanel,
} from "@/components/professor/professor-question-intake-panel";
import { ProfessorQuestionLifecyclePanel } from "@/components/professor/professor-question-lifecycle-panel";
import {
  ADD_QUESTION_HREF,
  professorQuestionsTabFromParam,
} from "@/components/professor/professor-questions-tab";
import { ProfessorQuestionsTabs } from "@/components/professor/professor-questions-tabs";
import { Button } from "@/components/ui/button";
import { getQuestionLifecycleDashboard } from "@/lib/data/data-store";
import {
  requireProfessorReview,
  requirePageAccess,
} from "@/lib/auth/authorization";

export const metadata: Metadata = {
  title: "Question bank",
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
  const { course, courses } = await getSelectedCourse();
  const [initialDashboard, params] = await Promise.all([
    getQuestionLifecycleDashboard(authorization, { courseId: course.id }),
    searchParams,
  ]);
  const activeQuestions = initialDashboard.questions.filter(
    (question) => question.recordState === "active",
  ).length;

  return (
    <ProfessorPageShell
      title="Question bank"
      breadcrumbs={[
        { label: "Home", href: "/professor" },
        { label: "Question bank" },
      ]}
      description={`${activeQuestions} ${activeQuestions === 1 ? "question" : "questions"}. Students only see questions you choose to show them.`}
      notice={initialDashboard.readOnly ? DEMO_NOTICE : undefined}
      courseFilter={
        <ProfessorCourseFilter
          courses={courses}
          returnTo="/professor/questions"
          selectedCourseId={course.id}
        />
      }
      aside={
        <Button asChild variant="cta" className="min-h-11">
          <Link href={ADD_QUESTION_HREF}>
            <Plus aria-hidden="true" />
            Add a question
          </Link>
        </Button>
      }
    >
      <ProfessorQuestionsTabs
        defaultTab={professorQuestionsTabFromParam(singleParam(params.tab))}
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
