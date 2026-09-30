import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown, Download } from "lucide-react";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { ProfessorCourseFilter } from "@/components/professor/professor-course-filter";
import { getSelectedCourse } from "@/lib/course-selection";
import {
  InstructorCohortPanel,
  InstructorCommonMistakes,
  STUDENTS_NEEDING_HELP_HREF,
} from "@/components/professor/instructor-cohort-panel";
import { InstructorPracticePerformance } from "@/components/professor/instructor-practice-performance";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  requireAnalyticsAccess,
  requirePageAccess,
} from "@/lib/auth/authorization";
import {
  getInstructorCohortAnalytics,
  getProfessorPracticeAnalytics,
} from "@/lib/data/data-store";

export const metadata: Metadata = {
  title: "Class progress",
};

export default async function ProfessorAnalyticsPage() {
  const authorization = await requirePageAccess(
    requireAnalyticsAccess,
    "/professor/analytics",
  );
  const { course, courses } = await getSelectedCourse();
  const scope = { courseId: course.id };
  const [cohort, practice] = await Promise.all([
    getInstructorCohortAnalytics(authorization, scope),
    getProfessorPracticeAnalytics(authorization, scope),
  ]);
  const needsHelp =
    cohort.mode !== "demo" && cohort.studentsNeedingAttention > 0;

  return (
    <ProfessorPageShell
      title="Class progress"
      breadcrumbs={[
        { label: "Home", href: "/professor" },
        { label: "Class progress" },
      ]}
      description="How the class is doing on the questions students can see. No student is named."
      courseFilter={
        <ProfessorCourseFilter
          courses={courses}
          returnTo="/professor/analytics"
          selectedCourseId={course.id}
        />
      }
      aside={
        needsHelp ? (
          <Button asChild variant="primary" className="min-h-11">
            <Link href={STUDENTS_NEEDING_HELP_HREF} prefetch={false}>
              See students who need help
            </Link>
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-10">
        <InstructorCohortPanel cohort={cohort} />
        <InstructorPracticePerformance practice={practice} />
        <InstructorCommonMistakes cohort={cohort} />
        <MoreOptions courseId={course.id} />
      </div>
    </ProfessorPageShell>
  );
}

/** The rare action, out of the header: the spreadsheet for research. */
function MoreOptions({ courseId }: { courseId: string }) {
  return (
    <div className="flex border-t border-rule pt-6">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="min-h-11">
            More options
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem asChild className="min-h-11 type-body">
            <a
              href={`/api/professor/analytics/export?course=${encodeURIComponent(courseId)}`}
            >
              <Download aria-hidden="true" />
              Download spreadsheet (no student names)
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
