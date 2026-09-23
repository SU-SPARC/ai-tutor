import Link from "next/link";

import type { LearnTopicRow } from "@/components/learn/learn-model";
import { cn } from "@/lib/utils";

/**
 * Zone 3. The syllabus as a numbered list: the same data as the rail, but
 * read rather than navigated. A topic with nothing published keeps its row and
 * its number so the week numbering never skips — it just says so and is not a
 * link.
 */
export function SyllabusList({
  emptyMessage,
  topics,
}: {
  emptyMessage: string;
  topics: LearnTopicRow[];
}) {
  if (topics.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <ol className="flex flex-col">
      {topics.map((topic) => (
        <li key={topic.id}>
          <SyllabusRow topic={topic} />
        </li>
      ))}
    </ol>
  );
}

function SyllabusRow({ topic }: { topic: LearnTopicRow }) {
  const index = String(topic.index).padStart(2, "0");
  const closed = topic.total === 0;

  const body = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
      <span
        aria-hidden="true"
        className="w-6 shrink-0 font-mono text-xs text-muted-foreground"
      >
        {index}
      </span>

      <span
        className={cn(
          "min-w-0 flex-1 text-sm",
          closed ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {topic.title}
        {topic.isCurrent ? (
          <span className="ml-2 text-xs whitespace-nowrap text-primary">
            ◀ you are here
          </span>
        ) : null}
      </span>

      {closed ? (
        <span className="font-mono text-xs text-muted-foreground">
          {topic.meta}
        </span>
      ) : (
        <span className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {`${topic.solved}/${topic.total}`}
          </span>
          <span
            aria-hidden="true"
            className="h-1.5 w-24 overflow-hidden rounded-full bg-indigo-100"
          >
            <span
              className="block h-1.5 rounded-full bg-indigo-500"
              style={{
                width: `${
                  topic.total > 0
                    ? Math.round((topic.solved / topic.total) * 100)
                    : 0
                }%`,
              }}
            />
          </span>
        </span>
      )}
    </div>
  );

  if (closed) {
    return <div aria-label={`${topic.title}: no questions yet`}>{body}</div>;
  }

  return (
    <Link
      href={topic.href}
      aria-current={topic.isCurrent ? "true" : undefined}
      className="block rounded-[6px] px-1 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {body}
    </Link>
  );
}
