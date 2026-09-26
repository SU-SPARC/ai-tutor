import Link from "next/link";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function ProfessorQuestionNotFound() {
  return (
    <ProfessorPageShell
      title="Question not found"
      breadcrumbs={[
        { label: "Workspace", href: "/professor" },
        { label: "Questions", href: "/professor/questions" },
        { label: "Not found" },
      ]}
      description="No question with this ID exists; it may have been mistyped or never saved."
    >
      <EmptyState
        className="rounded-panel bg-sheet px-5"
        action={
          <>
            <Button asChild>
              <Link href="/professor/questions">Open the question bank</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/professor/review">Open the review queue</Link>
            </Button>
          </>
        }
      >
        Saved drafts always appear in the question bank and, once submitted,
        in the review queue under their topic.
      </EmptyState>
    </ProfessorPageShell>
  );
}
