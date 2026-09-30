import Link from "next/link";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function ProfessorQuestionNotFound() {
  return (
    <ProfessorPageShell
      title="Question not found"
      breadcrumbs={[
        { label: "Home", href: "/professor" },
        { label: "Question bank", href: "/professor/questions" },
        { label: "Not found" },
      ]}
      description="We couldn't find that question. It may have been removed or the link was mistyped."
    >
      <EmptyState
        className="rounded-panel bg-sheet px-5"
        action={
          <Button asChild variant="cta" className="h-11">
            <Link href="/professor/questions">Go to Question bank</Link>
          </Button>
        }
      >
        Every question you have is listed in the Question bank.
      </EmptyState>
    </ProfessorPageShell>
  );
}
