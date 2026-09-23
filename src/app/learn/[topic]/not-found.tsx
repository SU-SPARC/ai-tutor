import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function TopicNotFound() {
  return (
    <div className="bg-surface-tint">
      <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <div className="flex flex-col items-start gap-4 rounded-lg bg-sheet p-6 text-sheet-foreground">
          <h1 className="font-display text-[28px] leading-9 font-normal">
            Topic not found
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            We could not find that topic. It may have been renamed, or it is not
            part of this course.
          </p>
          <Button asChild className="rounded-[6px]">
            <Link href="/learn">Back to Learn</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
