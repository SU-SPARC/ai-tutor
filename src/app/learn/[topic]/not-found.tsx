import Link from "next/link";

import { Button } from "@/components/ui/button";
import { StatusPage } from "@/components/ui/status-page";

export default function TopicNotFound() {
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
