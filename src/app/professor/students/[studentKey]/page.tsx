import { notFound } from "next/navigation";
import { UserRound } from "lucide-react";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { InstructorStudentDetailPanel } from "@/components/professor/instructor-student-detail";
import { Badge } from "@/components/ui/badge";
import {
  requireAnalyticsAccess,
  requirePageAccess,
} from "@/lib/auth/authorization";
import { getInstructorStudentDetail } from "@/lib/data/data-store";
import { isStudentKey, studentLabel } from "@/lib/professor/student-pseudonym";

export default async function ProfessorStudentPage({
  params,
}: {
  params: Promise<{ studentKey: string }>;
}) {
  const authorization = await requirePageAccess(
    requireAnalyticsAccess,
    "/professor/students",
  );
  const { studentKey } = await params;

  // A student key is only ever a hex digest. Anything else is a hand-written
  // URL and must not reach a query.
  if (!isStudentKey(studentKey)) {
    notFound();
  }

  const detail = await getInstructorStudentDetail(authorization, studentKey);

  if (!detail) {
    notFound();
  }

  return (
    <ProfessorPageShell
      title={studentLabel(studentKey)}
      description="Practice activity for one student. This view is derived from the same recorded sessions as the student's own dashboard; it carries no name, email address, or device identifier."
      aside={
        <Badge variant="outline" className="h-10 gap-2 px-4">
          <UserRound className="h-4 w-4" />
          pseudonymous record
        </Badge>
      }
    >
      <InstructorStudentDetailPanel detail={detail} />
    </ProfessorPageShell>
  );
}
