import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { InstructorStudentDetailPanel } from "@/components/professor/instructor-student-detail";
import { InstructorStudentIdentityPanel } from "@/components/professor/instructor-student-identity";
import { RelativeTime } from "@/components/professor/instructor-student-table";
import {
  requireAnalyticsAccess,
  requirePageAccess,
} from "@/lib/auth/authorization";
import { getInstructorStudentDetail } from "@/lib/data/data-store";
import { getServerEnv } from "@/lib/env/server";
import { isStudentKey, studentLabel } from "@/lib/professor/student-pseudonym";

export const metadata: Metadata = {
  title: "Student record",
};

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

  const label = studentLabel(studentKey);
  const lastActiveAt = detail.summary.lastActiveAt;

  return (
    <ProfessorPageShell
      title={label}
      breadcrumbs={[
        { label: "Workspace", href: "/professor" },
        { label: "Students", href: "/professor/students" },
        { label },
      ]}
      description="Practice recorded for one student, from the same sessions as their own dashboard."
      notice={
        <>
          {lastActiveAt ? (
            <>
              Last active <RelativeTime value={lastActiveAt} />
            </>
          ) : (
            "No practice recorded yet"
          )}
          {" · "}A pseudonymous record: no name, email address or device
          identifier is stored with it.
        </>
      }
    >
      <InstructorStudentIdentityPanel
        studentKey={studentKey}
        studentLabel={label}
      />
      <InstructorStudentDetailPanel
        detail={detail}
        sketchpadMeasurementEnabled={
          getServerEnv().SKETCHPAD_ACTIVE_TIME_MEASUREMENT_ENABLED
        }
      />
    </ProfessorPageShell>
  );
}
