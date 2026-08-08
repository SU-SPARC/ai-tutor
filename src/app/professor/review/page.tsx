import Link from "next/link";
import { ArrowLeft, ClipboardCheck } from "lucide-react";

import { ProfessorFriendlyReviewPanel } from "@/components/professor/professor-friendly-review-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getProfessorQuestionReviewDashboard } from "@/lib/data/data-store";
import {
  requirePageAccess,
  requireProfessorReview,
} from "@/lib/auth/authorization";

export default async function ProfessorReviewPage() {
  const authorization = await requirePageAccess(
    requireProfessorReview,
    "/professor/review",
  );
  const dashboard = await getProfessorQuestionReviewDashboard(authorization);

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
              Review by syllabus topic
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Choose one topic before loading any question details. Approval
              records an editorial decision; publishing remains a separate
              lifecycle action.
            </p>
          </div>
          <Badge variant="outline" className="h-10 gap-2 px-4">
            <ClipboardCheck className="h-4 w-4" />
            one at a time
          </Badge>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Review and publication queue</CardTitle>
            <CardDescription>
              Topics follow the canonical syllabus order. Questions are shown
              one at a time and only server-authorized review actions are
              available.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProfessorFriendlyReviewPanel initialDashboard={dashboard} />
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
