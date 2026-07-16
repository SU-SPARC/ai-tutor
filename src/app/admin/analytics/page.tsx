import Link from "next/link"
import { ArrowLeft, BarChart3 } from "lucide-react"

import { InstructorAnalyticsPanel } from "@/components/admin/instructor-analytics-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export default function AdminAnalyticsPage() {
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
              Instructor analytics
            </Badge>
            <h1 className="text-3xl font-semibold tracking-normal">
              Course practice overview
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              Aggregate practice, review, usage, and misconception trends for
              instructor review. Private source material and student identifiers
              stay off this route.
            </p>
          </div>
          <Badge variant="outline" className="h-10 gap-2 px-4">
            <BarChart3 className="h-4 w-4" />
            aggregate only
          </Badge>
        </div>

        <InstructorAnalyticsPanel />
      </section>
    </main>
  )
}
