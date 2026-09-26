import Link from "next/link";

import { Button } from "@/components/ui/button";
import { StatusPage } from "@/components/ui/status-page";

export default function LearnNotFound() {
  return (
    <StatusPage
      code="404"
      title="Page not found"
      description="That page is not part of the course. Your syllabus is where you left it."
      actions={
        <Button asChild>
          <Link href="/learn">Back to Learn</Link>
        </Button>
      }
    />
  );
}
