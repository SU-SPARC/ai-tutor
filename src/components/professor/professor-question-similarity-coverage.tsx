import type { QuestionSimilarityCoverageDto } from "@/lib/types";

/**
 * How many eligible reserve siblings each published question in the topic
 * has, out of the 3 the similar-practice flow can offer. A quiet panel.
 */
export function ProfessorQuestionSimilarityCoverage({
  coverage,
  topicTitle,
}: {
  coverage: QuestionSimilarityCoverageDto[];
  topicTitle: string;
}) {
  return (
    <section
      aria-labelledby="similarity-coverage-heading"
      className="flex flex-col gap-4 rounded-panel bg-surface-tint p-4 sm:p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="similarity-coverage-heading" className="type-h3 text-ink">
          Dedicated sibling coverage
        </h2>
        <p className="type-small max-w-prose text-ink-muted">
          {topicTitle}: eligible siblings pinned to each published version,
          out of 3.
        </p>
      </div>
      {coverage.length ? (
        <ul className="flex flex-col divide-y divide-rule rounded-panel bg-sheet px-4">
          {coverage.map((row) => (
            <li
              className="flex items-center justify-between gap-3 py-2.5 type-small text-ink"
              key={row.originQuestionId}
            >
              <span className="min-w-0 truncate">{row.originTitle}</span>
              <span className="shrink-0 font-mono tabular text-ink-muted">
                {row.eligibleSiblingCount}/{row.targetSiblingCount}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="type-small text-ink-muted">
          No published questions are available for this topic yet.
        </p>
      )}
    </section>
  );
}
