import type { QuestionSimilarityCoverageDto } from "@/lib/types";

/**
 * How many extra-practice questions are ready after each question students
 * can see in this topic, out of the 3 that can be offered. The detail page
 * shows it only while students can see the question.
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
      className="flex flex-col gap-4 rounded-panel bg-sheet p-4 sm:p-5"
    >
      <div className="flex flex-col gap-1">
        <h3 id="similarity-coverage-heading" className="type-h3 text-ink">
          Extra practice in {topicTitle}
        </h3>
        <p className="type-body max-w-prose text-ink">
          Each question students can see can offer up to 3 extra-practice
          questions.
        </p>
      </div>
      {coverage.length ? (
        <ul className="flex flex-col divide-y divide-rule rounded-panel bg-surface-tint px-4">
          {coverage.map((row) => (
            <li
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5 type-body text-ink"
              key={row.originQuestionId}
            >
              <span className="min-w-0">“{row.originTitle}”</span>
              <span className="shrink-0 tabular">
                {row.eligibleSiblingCount} of {row.targetSiblingCount}{" "}
                extra-practice questions ready
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="type-body text-ink">
          Students can&apos;t see any questions in this topic yet.
        </p>
      )}
    </section>
  );
}
