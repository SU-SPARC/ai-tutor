import Link from "next/link";

import type { SavedPracticeRow } from "@/components/learn/learn-model";

/**
 * Saved practice as a plain list: the question title is the link, the line
 * under it says where it sits and how far it got. Anything the professor
 * retired stays below under its own label rather than being deleted — the
 * attempts still happened.
 */
export function SavedPractice({
  active,
  retired,
}: {
  active: SavedPracticeRow[];
  retired: SavedPracticeRow[];
}) {
  if (active.length === 0 && retired.length === 0) {
    return (
      <p className="type-small text-ink-muted">
        No saved practice yet. Answer a question and it will be waiting here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {active.length > 0 ? (
        <ul className="flex flex-col">
          {active.map((row) => (
            <li key={row.sessionId}>
              <SavedPracticeItem row={row} />
            </li>
          ))}
        </ul>
      ) : null}

      {retired.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h3 className="type-label">
            Retired <span className="tabular">{retired.length}</span>
          </h3>
          <ul className="flex flex-col">
            {retired.map((row) => (
              <li key={row.sessionId}>
                <SavedPracticeItem row={row} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function statusWords(row: SavedPracticeRow) {
  const hints =
    row.hintsUsed > 0
      ? `${row.hintsUsed} hint${row.hintsUsed === 1 ? "" : "s"} used`
      : undefined;

  if (row.status === "unavailable") {
    return ["retired by your professor", "your attempts are kept"];
  }

  return [row.status === "completed" ? "completed" : "in progress", hints];
}

function SavedPracticeItem({ row }: { row: SavedPracticeRow }) {
  const topic = row.isExtraPractice
    ? `${row.topicLabel} · extra practice`
    : row.topicLabel;
  const meta = [topic, ...statusWords(row)]
    .filter((part): part is string => Boolean(part))
    .join(" · ");

  if (!row.href) {
    return (
      <div className="flex flex-col gap-0.5 py-2">
        <p className="type-body text-ink-muted">{row.title}</p>
        <p className="type-caption">{meta}</p>
      </div>
    );
  }

  return (
    <div className="group relative -mx-2 flex flex-col gap-0.5 rounded-control px-2 py-2 transition-colors duration-fast ease-out hover:bg-hover">
      <Link
        href={row.href}
        className="type-body-strong w-fit rounded-xs text-ink focus-ring after:absolute after:inset-0 after:rounded-control group-hover:underline group-hover:underline-offset-4"
      >
        {row.title}
      </Link>
      <p className="type-caption">{meta}</p>
    </div>
  );
}
