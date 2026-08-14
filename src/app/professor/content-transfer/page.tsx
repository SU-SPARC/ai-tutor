import Link from "next/link";
import { ArrowLeft, FileJson } from "lucide-react";

import { ProfessorContentTransferPanel } from "@/components/professor/professor-content-transfer-panel";
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
  requirePageAccess,
  requireProfessorReview,
} from "@/lib/auth/authorization";

export default async function ProfessorContentTransferPage() {
  await requirePageAccess(
    requireProfessorReview,
    "/professor/content-transfer",
  );

  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
        <div className="flex flex-col gap-4 border-b pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <Button asChild variant="ghost" size="sm" className="mb-3 px-0">
              <Link href="/professor">
                <ArrowLeft className="h-4 w-4" />
                Professor workspace
              </Link>
            </Button>
            <Badge variant="secondary" className="mb-3">
              Protected content operations
            </Badge>
            <h1 className="text-3xl font-semibold tracking-normal">
              Import and export question content
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              Preview validated question JSON, inspect row-level errors, and
              explicitly confirm imports. Importing an approved review state
              never publishes the question to students.
            </p>
          </div>
          <Badge variant="outline" className="h-10 gap-2 px-4">
            <FileJson className="h-4 w-4" />
            schema v1
          </Badge>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Question content transfer</CardTitle>
            <CardDescription>
              Production imports require database storage. Demo mode supports
              sanitized exports and read-only validation previews.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProfessorContentTransferPanel />
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
