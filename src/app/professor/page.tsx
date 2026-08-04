import Link from "next/link";
import { ArrowLeft, ClipboardCheck, Gauge, LockKeyhole } from "lucide-react";

import { ProfessorReviewPanel } from "@/components/tutor/professor-review-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requirePageAccess, requireProfessor } from "@/lib/auth/authorization";

export default async function ProfessorPage() {
  await requirePageAccess(requireProfessor, "/professor");
  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
        <div className="flex flex-col gap-4 border-b pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <Button asChild variant="ghost" size="sm" className="mb-3 px-0">
              <Link href="/">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Link>
            </Button>
            <Badge variant="secondary" className="mb-3">
              Professor workspace
            </Badge>
            <h1 className="text-3xl font-semibold tracking-normal">
              Review generated practice questions
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Draft questions are separated from approved student-facing
              content. The server verifies your current instructor permissions
              before every read and review action.
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardCheck className="h-4 w-4 text-primary" />
                Pending drafts
              </CardTitle>
              <CardDescription>
                Queue access is limited to signed-in instructor accounts.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Gauge className="h-4 w-4 text-primary" />
                Usage dashboard
              </CardTitle>
              <CardDescription>
                Aggregate model usage, cache hits, and limits load only after
                instructor access is verified.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <LockKeyhole className="h-4 w-4 text-primary" />
                Server-side control
              </CardTitle>
              <CardDescription>
                Review changes are attributed to the signed-in account and
                handled only by protected server routes.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Review queue</CardTitle>
            <CardDescription>
              Approve and reject actions are recorded under your authenticated
              application account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProfessorReviewPanel />
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
