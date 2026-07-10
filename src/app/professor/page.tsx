import Link from "next/link"
import { ArrowLeft, ClipboardCheck, Gauge, LockKeyhole } from "lucide-react"

import { ProfessorReviewPanel } from "@/components/tutor/professor-review-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { getReviewQueue } from "@/lib/data/data-store"

export default async function ProfessorPage() {
  const reviewQueue = await getReviewQueue()

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
              content. Approval mutations require a server-side ADMIN_SECRET.
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
                {
                  reviewQueue.filter(
                    (candidate) => candidate.review.status === "needs_review",
                  ).length
                }{" "}
                question drafts need review.
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
                Aggregate LLM calls, provider tokens, cache hits, and limits
                load after professor authentication.
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
                Review changes and LLM fallbacks are handled only by server
                routes.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Review queue</CardTitle>
            <CardDescription>
              Enter the professor token locally to test approve/reject actions.
              Without it, the route stays read-only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProfessorReviewPanel initialCandidates={reviewQueue} />
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
