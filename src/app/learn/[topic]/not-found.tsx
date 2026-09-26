import Link from "next/link";

import { Button } from "@/components/ui/button";
import { StatusPage } from "@/components/ui/status-page";

export default function TopicNotFound() {
  return (
    <StatusPage
      code="404"
      title="Topic not found"
      description="That topic is not part of this course, or it has been renamed. Every topic is listed on the syllabus."
      actions={
        <Button asChild>
          <Link href="/learn">Back to Learn</Link>
        </Button>
      }
    />
  );
}
