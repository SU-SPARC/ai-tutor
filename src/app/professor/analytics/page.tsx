import { BarChart3 } from "lucide-react";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { InstructorAnalyticsPanel } from "@/components/professor/instructor-analytics-panel";
import { Badge } from "@/components/ui/badge";
import {
  requireAnalyticsAccess,
  requirePageAccess,
} from "@/lib/auth/authorization";

export default async function ProfessorAnalyticsPage() {
  await requirePageAccess(requireAnalyticsAccess, "/professor/analytics");
  return (
    <ProfessorPageShell
      title="Course practice overview"
      description="Aggregate practice, review, usage, and misconception trends for instructor review. Private source material and student identifiers stay off this route."
      aside={
        <Badge variant="outline" className="h-10 gap-2 px-4">
          <BarChart3 className="h-4 w-4" />
          aggregate only
        </Badge>
      }
    >
      <InstructorAnalyticsPanel />
    </ProfessorPageShell>
  );
}
