import Link from "next/link";

import type { SavedPracticeRow } from "@/components/learn/learn-model";

/**
 * Recent practice as a plain list: the question title is the link, the line
 * under it says where it sits and how far it got. The model puts in-progress
 * rows first. With `limit`, the first rows show and the rest sit behind a
 * "Show all" disclosure (no script needed). Anything your professor removed
 * stays below under "No longer available" rather than being deleted: the
 * answers still happened.
 */
export function SavedPractice({
  active,
  limit,
  retired,
}: {
  active: SavedPracticeRow[];
  /** Rows shown before "Show all"; omit to show every row. */
  limit?: number;
  retired: SavedPracticeRow[];
}) {
  if (active.length === 0 && retired.length === 0) {
    return (
      <p className="type-small text-ink-muted">
        Nothing yet. Answer a question and it will be waiting here.
      </p>
    );
  }

  const shown = limit === undefined ? active : active.slice(0, limit);
  const hidden = limit === undefined ? [] : active.slice(limit);
  const hiddenCount = hidden.length + (limit === undefined ? 0 : retired.length);

  const removed =
    retired.length > 0 ? (
      <section className="flex flex-col gap-1">
        <h3 className="type-label">
          No longer available <span className="tabular">{retired.length}</span>
        </h3>
        <RowList rows={retired} />
      </section>
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      {shown.length > 0 ? <RowList rows={shown} /> : null}

      {limit !== undefined && hiddenCount > 0 ? (
        <details className="group/all flex flex-col gap-4">
          <summary className="type-small w-fit cursor-pointer rounded-xs text-azure-500 underline-offset-4 hover:text-azure-700 hover:underline focus-ring">
            {`Show all (${active.length + retired.length})`}
          </summary>
          <div className="mt-2 flex flex-col gap-4">
            {hidden.length > 0 ? <RowList rows={hidden} /> : null}
            {removed}
          </div>
        </details>
      ) : (
        removed
      )}
    </div>
  );
}

function RowList({ rows }: { rows: SavedPracticeRow[] }) {
  return (
    <ul className="flex flex-col">
      {rows.map((row) => (
        <li key={row.sessionId}>
          <SavedPracticeItem row={row} />
        </li>
      ))}
    </ul>
  );
}

function statusWords(row: SavedPracticeRow) {
  const hints =
    row.hintsUsed > 0
      ? `${row.hintsUsed} hint${row.hintsUsed === 1 ? "" : "s"} used`
      : undefined;

  if (row.status === "unavailable") {
    return ["removed by your professor", "your answers are kept"];
  }

  return [row.status === "completed" ? "solved" : "In progress", hints];
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
