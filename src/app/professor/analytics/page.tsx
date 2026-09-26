import type { Metadata } from "next";
import { Download } from "lucide-react";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { InstructorCohortPanel } from "@/components/professor/instructor-cohort-panel";
import { InstructorPracticePerformance } from "@/components/professor/instructor-practice-performance";
import { Button } from "@/components/ui/button";
import {
  requireAnalyticsAccess,
  requirePageAccess,
} from "@/lib/auth/authorization";
import {
  getInstructorCohortAnalytics,
  getProfessorPracticeAnalytics,
} from "@/lib/data/data-store";

export const metadata: Metadata = {
  title: "Analytics",
};

export default async function ProfessorAnalyticsPage() {
  const authorization = await requirePageAccess(
    requireAnalyticsAccess,
    "/professor/analytics",
  );
  const [cohort, practice] = await Promise.all([
    getInstructorCohortAnalytics(authorization),
    getProfessorPracticeAnalytics(authorization),
  ]);
  const demo = cohort.mode === "demo" || practice.mode === "demo";

  return (
    <ProfessorPageShell
      title="Analytics"
      breadcrumbs={[
        { label: "Workspace", href: "/professor" },
        { label: "Analytics" },
      ]}
      description="Published-practice performance and tutor use across the class, with no student named."
      notice={
        demo
          ? "Demo data: nothing here comes from a recorded class."
          : "Descriptive pilot metrics; they do not measure learning improvement."
      }
      aside={
        <Button asChild variant="secondary">
          <a href="/api/professor/analytics/export">
            <Download aria-hidden="true" />
            Download research export
          </a>
        </Button>
      }
    >
      <div className="flex flex-col gap-10">
        <InstructorCohortPanel cohort={cohort} />
        <InstructorPracticePerformance practice={practice} />
      </div>
    </ProfessorPageShell>
  );
}
