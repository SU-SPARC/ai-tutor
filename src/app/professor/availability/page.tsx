import { ShieldCheck } from "lucide-react";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { ProfessorContentAvailabilityPanel } from "@/components/professor/professor-content-availability-panel";
import { Badge } from "@/components/ui/badge";
import { getContentAvailabilityDashboard } from "@/lib/data/data-store";
import {
  requireProfessorReview,
  requirePageAccess,
} from "@/lib/auth/authorization";

export default async function ProfessorAvailabilityPage() {
  const authorization = await requirePageAccess(
    requireProfessorReview,
    "/professor/availability",
  );
  const initialDashboard = await getContentAvailabilityDashboard(authorization);

  return (
    <ProfessorPageShell
      title="Approved question availability"
      description="Publish globally, schedule, unpublish, or archive student access for professor-approved questions. Availability is a separate gate from review approval, so changes here never alter a review decision or an immutable version."
      aside={
        <Badge variant="outline" className="h-10 gap-2 px-4">
          <ShieldCheck className="h-4 w-4" />
          private materials excluded
        </Badge>
      }
    >
      <ProfessorContentAvailabilityPanel initialDashboard={initialDashboard} />
    </ProfessorPageShell>
  );
}
