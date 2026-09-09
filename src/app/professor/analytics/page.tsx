import { BarChart3, Download, Info } from "lucide-react";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { InstructorCohortPanel } from "@/components/professor/instructor-cohort-panel";
import { InstructorPracticePerformance } from "@/components/professor/instructor-practice-performance";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  requireAnalyticsAccess,
  requirePageAccess,
} from "@/lib/auth/authorization";
import {
  getInstructorCohortAnalytics,
  getProfessorPracticeAnalytics,
} from "@/lib/data/data-store";

export default async function ProfessorAnalyticsPage() {
  const authorization = await requirePageAccess(
    requireAnalyticsAccess,
    "/professor/analytics",
  );
  const [cohort, practice] = await Promise.all([
    getInstructorCohortAnalytics(authorization),
    getProfessorPracticeAnalytics(authorization),
  ]);
  return (
    <ProfessorPageShell
      title="Course practice overview"
      description="Aggregate published-practice performance and tutor usage for instructor review. Private source material and student identifiers stay off this route."
      aside={
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="h-10 gap-2 px-4">
            <BarChart3 className="h-4 w-4" />
            aggregate only
          </Badge>
          <Button asChild variant="outline">
            <a href="/api/professor/analytics/export">
              <Download />
              Download research export
            </a>
          </Button>
        </div>
      }
    >
      <Alert variant="info">
        <Info />
        <AlertTitle>Descriptive pilot metrics</AlertTitle>
        <AlertDescription>
          The export separates usage, observed answer performance, and feedback.
          It does not measure or establish learning improvement.
        </AlertDescription>
      </Alert>

      <InstructorCohortPanel cohort={cohort} />

      <InstructorPracticePerformance practice={practice} />
    </ProfessorPageShell>
  );
}
