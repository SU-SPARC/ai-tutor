import type { Metadata } from "next";

import { ProgressDashboard } from "@/components/student/progress-dashboard";
import { requirePageAccess, requireStudent } from "@/lib/auth/authorization";
import { getStudentProgress } from "@/lib/data/student-progress";

export const metadata: Metadata = {
  title: "Your practice progress | Suffolk Probability Tutor",
};
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const authorization = await requirePageAccess(requireStudent, "/dashboard");
  const progress = await getStudentProgress(authorization);

  return <ProgressDashboard progress={progress} />;
}
