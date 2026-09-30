import Link from "next/link";

import { Button } from "@/components/ui/button";

/** "Change course", returning to the page the student was on. */
export function CourseChangeLink({ returnTo }: { returnTo: string }) {
  return (
    <Button asChild variant="secondary" size="sm">
      <Link href={`/courses?returnTo=${encodeURIComponent(returnTo)}`}>
        Change course
      </Link>
    </Button>
  );
}
