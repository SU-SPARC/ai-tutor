import Link from "next/link";

import { Button } from "@/components/ui/button";
import { StatusPage } from "@/components/ui/status-page";

export default function PracticeQuestionNotFound() {
  return (
    <StatusPage
      code="404"
      title="Question not available"
      description="This question could not be found or is not published for practice yet. Pick another one to keep going."
      actions={
        <>
          <Button asChild>
            <Link href="/learn">Browse topics</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/practice">Open practice</Link>
          </Button>
        </>
      }
    />
  );
}
