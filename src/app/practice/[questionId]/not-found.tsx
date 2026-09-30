import Link from "next/link";

import { Button } from "@/components/ui/button";
import { StatusPage } from "@/components/ui/status-page";

export default function PracticeQuestionNotFound() {
  return (
    <StatusPage
      title="Question not available"
      description="This question isn't available. Your professor may have removed it or not opened it yet."
      actions={
        <>
          <Button asChild>
            <Link href="/learn">Back to Learn</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/practice">Practice something else</Link>
          </Button>
        </>
      }
    />
  );
}
