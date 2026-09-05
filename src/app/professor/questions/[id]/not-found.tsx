import Link from "next/link";
import { SearchX } from "lucide-react";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function ProfessorQuestionNotFound() {
  return (
    <ProfessorPageShell
      title="Question not found"
      description="No question with this ID exists in the lifecycle. It may have been typed incorrectly or never saved."
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SearchX className="h-5 w-5 text-primary" />
            Nothing to show here
          </CardTitle>
          <CardDescription>
            Saved drafts always appear in the question lifecycle table and, once
            submitted, in the Review Queue under their topic.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/professor/questions">Open question lifecycle</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/professor/review">Open Review Queue</Link>
          </Button>
        </CardContent>
      </Card>
    </ProfessorPageShell>
  );
}
