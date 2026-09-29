import Link from "next/link";

import { Button } from "@/components/ui/button";
import { StatusPage } from "@/components/ui/status-page";

/** Everything under `/learn/` is a topic, so a miss here is a missing topic. */
export default function LearnNotFound() {
  return (
    <StatusPage
      code="404"
      title="Topic not found"
      description="That topic isn't in your syllabus."
      actions={
        <Button asChild>
          <Link href="/learn">Back to Learn</Link>
        </Button>
      }
    />
  );
}
