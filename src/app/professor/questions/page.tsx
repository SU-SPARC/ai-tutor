import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

import { ProfessorQuestionReviewPanel } from "@/components/professor/professor-question-review-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAdminQuestionDashboard } from "@/lib/data/data-store";
import {
  requireProfessorReview,
  requirePageAccess,
} from "@/lib/auth/authorization";

export default async function ProfessorQuestionsPage() {
  const authorization = await requirePageAccess(
    requireProfessorReview,
    "/professor/questions",
  );
  const initialDashboard = await getAdminQuestionDashboard(authorization);

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
              Review public-safe question records by source, status, topic, and
              difficulty. Access and mutations require the professor role.
            </p>
          </div>
          <Badge variant="outline" className="h-10 gap-2 px-4">
            <ShieldCheck className="h-4 w-4" />
            private materials excluded
          </Badge>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Professor question queue</CardTitle>
            <CardDescription>
              Demo mode is read-only. Database-backed review can approve,
              reject, mark needs review, or request regeneration.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProfessorQuestionReviewPanel initialDashboard={initialDashboard} />
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
