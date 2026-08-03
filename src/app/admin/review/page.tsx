import Link from "next/link";
import { ArrowLeft, ClipboardCheck } from "lucide-react";

import { ProfessorFriendlyReviewPanel } from "@/components/admin/professor-friendly-review-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listTopics } from "@/lib/data/data-store";
import { safeTopics } from "@/lib/tutor/professor-admin";

export default async function AdminReviewPage() {
  const topics = safeTopics(await listTopics());

  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8">
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
              Lightweight question review
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Review one generated draft at a time with only the essentials.
              Private course files and technical audit details stay hidden.
            </p>
          </div>
          <Badge variant="outline" className="h-10 gap-2 px-4">
            <ClipboardCheck className="h-4 w-4" />
            one at a time
          </Badge>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Review queue</CardTitle>
            <CardDescription>
              Your professor or administrator role authorizes review actions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProfessorFriendlyReviewPanel topics={topics} />
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
