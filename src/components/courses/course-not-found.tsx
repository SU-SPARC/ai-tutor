import Link from "next/link";
import { SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { coursesIndexPath } from "@/lib/courses/paths";

/**
 * Course state lives in the browser, so the server cannot know whether an ID
 * exists. Pages validate the ID's shape and let the client render this when the
 * store has no such record.
 */
export function CourseNotFound({
  what = "course",
}: {
  what?: "course" | "section" | "topic" | "question";
}) {
  return (
    <Card className="max-w-xl">
      <CardHeader className="space-y-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <SearchX className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">
            That {what} is not in this demo
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The link may be from an older demo state, or the {what} was archived
            and removed. Nothing has been changed.
          </p>
        </div>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link href={coursesIndexPath()}>Back to courses</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
