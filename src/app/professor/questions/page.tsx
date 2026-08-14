import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

import { ProfessorQuestionLifecyclePanel } from "@/components/professor/professor-question-lifecycle-panel";
import { ProfessorContentAvailabilityPanel } from "@/components/professor/professor-content-availability-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getContentAvailabilityDashboard,
  getQuestionLifecycleDashboard,
} from "@/lib/data/data-store";
import {
  requireProfessorReview,
  requirePageAccess,
} from "@/lib/auth/authorization";

export default async function ProfessorQuestionsPage() {
  const authorization = await requirePageAccess(
    requireProfessorReview,
    "/professor/questions",
  );
  const [initialAvailabilityDashboard, initialDashboard] = await Promise.all([
    getContentAvailabilityDashboard(authorization),
    getQuestionLifecycleDashboard(authorization),
  ]);

  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
        <div className="flex flex-col gap-4 border-b pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <Button asChild variant="ghost" size="sm" className="mb-3 px-0">
              <Link href="/">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Link>
            </Button>
            <Badge variant="secondary" className="mb-3">
              Professor review
            </Badge>
            <h1 className="text-3xl font-semibold tracking-normal">
              Question review
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              Operate immutable question versions from draft through review,
              approval, publication, rollback, and archival.
            </p>
          </div>
          <Badge variant="outline" className="h-10 gap-2 px-4">
            <ShieldCheck className="h-4 w-4" />
            private materials excluded
          </Badge>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Student availability</CardTitle>
            <CardDescription>
              Publish globally, schedule, unpublish, or archive student access
              without changing review approval.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProfessorContentAvailabilityPanel
              initialDashboard={initialAvailabilityDashboard}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Professor question queue</CardTitle>
            <CardDescription>
              Demo mode is read-only. Production changes use explicit,
              attributed lifecycle transitions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProfessorQuestionLifecyclePanel
              initialDashboard={initialDashboard}
            />
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
