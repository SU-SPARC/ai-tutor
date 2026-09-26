import type { Metadata } from "next";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { ProfessorContentAvailabilityPanel } from "@/components/professor/professor-content-availability-panel";
import { getContentAvailabilityDashboard } from "@/lib/data/data-store";
import {
  requireProfessorReview,
  requirePageAccess,
} from "@/lib/auth/authorization";

export const metadata: Metadata = {
  title: "Student availability",
};

export default async function ProfessorAvailabilityPage() {
  const authorization = await requirePageAccess(
    requireProfessorReview,
    "/professor/availability",
  );
  const initialDashboard = await getContentAvailabilityDashboard(authorization);

  return (
    <ProfessorPageShell
      title="Student availability"
      breadcrumbs={[
        { label: "Workspace", href: "/professor" },
        { label: "Student availability" },
      ]}
      description="Publish, schedule, unpublish or archive what students can reach, topic by topic and question by question."
      notice={
        initialDashboard.mode === "demo"
          ? "Demo data · Private source material is never exposed here."
          : "Private source material is never exposed here."
      }
    >
      <ProfessorContentAvailabilityPanel initialDashboard={initialDashboard} />
    </ProfessorPageShell>
  );
}
