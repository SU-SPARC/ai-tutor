import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import {
  InstructorStudentDetailPanel,
  studentHasActivity,
} from "@/components/professor/instructor-student-detail";
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
  const env = getServerEnv();
  const sketchpadMeasurementEnabled =
    env.SKETCHPAD_ACTIVE_TIME_MEASUREMENT_ENABLED;
  // The header and the panel's "nothing yet" sentence use one test.
  const hasActivity = studentHasActivity(
    detail.summary,
    sketchpadMeasurementEnabled,
  );
  // Titled by the student code: identity lookups are confined to the
  // Students list and the explicit "Show name and email" reveal below (see
  // tests/professor-student-identity.test.ts).

  return (
    <ProfessorPageShell
      title={label}
      breadcrumbs={[
        { label: "Home", href: "/professor" },
        { label: "Students", href: "/professor/students" },
        { label },
      ]}
      description="What this student has practiced and how it went."
      notice={
        <>
          {!hasActivity ? (
            "No practice yet"
          ) : lastActiveAt ? (
            <>
              Last active <RelativeTime value={lastActiveAt} withDate />
            </>
          ) : null}
        </>
      }
    >
      <InstructorStudentIdentityPanel
        studentKey={studentKey}
        studentLabel={label}
      />
      <InstructorStudentDetailPanel
        aiEnabled={env.AI_ENABLED}
        detail={detail}
        sketchpadMeasurementEnabled={sketchpadMeasurementEnabled}
      />
    </ProfessorPageShell>
  );
}
