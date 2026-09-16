import type {
  PracticeCreditEvidence,
  PracticeCreditRoute,
  TutorMode,
  TutorVerdict,
} from "@/lib/types";

export type { PracticeCreditEvidence, PracticeCreditRoute };

/**
 * Practice-credit evidence for the course policy.
 *
 * The tutor is not a gradebook. This module turns recorded tutor interactions
 * into the evidence an instructor needs to apply the policy themselves:
 *
 * - Full credit (1.0): a correct answer within FULL_CREDIT_VALID_ATTEMPT_LIMIT
 *   valid answer attempts, and the worked solution was not revealed before
 *   that first correct answer. Revealing the solution first ends eligibility
 *   for this route on the question, whatever happens afterwards.
 * - Partial credit (0.9): the question was not completed on the full route,
 *   and the student then solved a linked similar problem.
 * - Manual review: the original was solved after the worked solution was
 *   revealed and no linked similar problem was solved. The documented
 *   fallback (no similar problem available, Start over, solve the original)
 *   needs a fact nothing persists — that no similar problem was available —
 *   so the record cannot prove it. No number is derived; the instructor
 *   decides from the facts shown.
 * - Not qualified: neither route is proven.
 *
 * A valid answer attempt is a Check answer submission the tutor could read and
 * judged correct or incorrect. Unreadable submissions, blocked responses,
 * hints, solution reveals, and AI help are recorded interactions but never
 * valid attempts. The same definition is used by the student dashboard and the
 * instructor view, in TypeScript here and as the SQL fragment below.
 *
 * Nothing here caps what a student may do: the limit classifies evidence, it
 * does not stop practice.
 */

export const FULL_CREDIT_VALID_ATTEMPT_LIMIT = 3;

export type ValidAnswerAttemptLike = {
  mode?: TutorMode | string;
  verdict?: TutorVerdict | string;
};

/**
 * Legacy attempt rows recorded before the mode was persisted were always
 * Check answer submissions, so a missing mode reads as `check`. A missing
 * verdict is a submission whose outcome was never settled and does not count.
 */
export function isValidAnswerAttempt(attempt: ValidAnswerAttemptLike) {
  const mode = attempt.mode ?? "check";
  return (
    mode === "check" &&
    (attempt.verdict === "correct" || attempt.verdict === "incorrect")
  );
}

export function isWorkedSolutionReveal(attempt: ValidAnswerAttemptLike) {
  return attempt.mode === "solution" || attempt.mode === "full_solution";
}

/**
 * Trusted SQL fragments for `attempts` aliased as `a`, never user input. They
 * must stay equivalent to the predicates above; the database analytics test
 * exercises both sides.
 */
export const VALID_ANSWER_ATTEMPT_SQL = `(a.mode = 'check' and a.verdict in ('correct', 'incorrect'))`;
export const WORKED_SOLUTION_REVEAL_SQL = `(a.mode in ('solution', 'full_solution'))`;

export type PracticeCreditInteraction = {
  createdAt: string;
  /** Tie-breaker for interactions recorded in the same instant. */
  id?: string;
  mode?: TutorMode | string;
  verdict?: TutorVerdict | string;
};

export type PracticeCreditLinkedSimilarProblem = {
  /** At least one valid answer attempt was made on the similar problem. */
  attempted: boolean;
  solved: boolean;
};

export type PracticeCreditEvidenceInput = {
  /**
   * Every recorded interaction across all of the student's published
   * sessions for the question, in any order. Start over creates a new
   * session, so attempts must be gathered across sessions and ordered by
   * time here: a restart never resets the count.
   */
  interactions: PracticeCreditInteraction[];
  publishedSessionCount: number;
  /**
   * Linked similar problems only: reserve-practice sessions whose origin is
   * one of this question's published sessions. Unrelated reserve practice is
   * never passed here and never satisfies the route.
   */
  similarProblems: PracticeCreditLinkedSimilarProblem[];
  /**
   * Whether any published session is recorded as solved. Covers sessions that
   * carry only counters and no attempt rows; a correct valid attempt implies
   * this on its own.
   */
  solved: boolean;
};

/** Database ids are serial integers; compare them as numbers, not text. */
function compareIds(left = "", right = "") {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (
    left !== "" &&
    right !== "" &&
    Number.isFinite(leftNumber) &&
    Number.isFinite(rightNumber)
  ) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right);
}

function compareInteractions(
  left: PracticeCreditInteraction,
  right: PracticeCreditInteraction,
) {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    compareIds(left.id, right.id)
  );
}

export function derivePracticeCreditEvidence(
  input: PracticeCreditEvidenceInput,
): PracticeCreditEvidence {
  const ordered = [...input.interactions].sort(compareInteractions);
  let validAttempts = 0;
  let validAttemptsToFirstCorrect: number | undefined;
  let solutionRevealed = false;
  let solutionRevealedBeforeFirstCorrect = false;

  for (const interaction of ordered) {
    if (isWorkedSolutionReveal(interaction)) {
      solutionRevealed = true;
      continue;
    }
    if (!isValidAnswerAttempt(interaction)) {
      continue;
    }
    validAttempts += 1;
    if (
      validAttemptsToFirstCorrect === undefined &&
      interaction.verdict === "correct"
    ) {
      validAttemptsToFirstCorrect = validAttempts;
      solutionRevealedBeforeFirstCorrect = solutionRevealed;
    }
  }

  const solved = validAttemptsToFirstCorrect !== undefined || input.solved;
  const workedSolutionViewedBeforeFirstCorrect =
    validAttemptsToFirstCorrect === undefined
      ? solutionRevealed
      : solutionRevealedBeforeFirstCorrect;
  const solvedWithinValidAttemptLimit =
    validAttemptsToFirstCorrect !== undefined &&
    validAttemptsToFirstCorrect <= FULL_CREDIT_VALID_ATTEMPT_LIMIT;
  const similarProblemAttempted = input.similarProblems.some(
    (problem) => problem.attempted || problem.solved,
  );
  const similarProblemSolved = input.similarProblems.some(
    (problem) => problem.solved,
  );

  const route: PracticeCreditRoute =
    solvedWithinValidAttemptLimit && !workedSolutionViewedBeforeFirstCorrect
      ? "full"
      : similarProblemSolved
        ? "partial_similar"
        : solved && workedSolutionViewedBeforeFirstCorrect
          ? "manual_review"
          : "not_qualified";

  return {
    route,
    similarProblemAttempted,
    similarProblemSolved,
    solved,
    solvedWithinValidAttemptLimit,
    startOverUsed: input.publishedSessionCount > 1,
    validAttempts,
    validAttemptsToFirstCorrect,
    workedSolutionViewedBeforeFirstCorrect,
  };
}

/** Instructor-facing wording. Evidence for a decision, never a grade. */
export const PRACTICE_CREDIT_ROUTE_LABELS: Record<PracticeCreditRoute, string> =
  {
    full: "Full-credit route (1.0)",
    manual_review: "Manual review",
    not_qualified: "Not yet qualified",
    partial_similar: "Partial-credit route (0.9) · similar problem solved",
  };

/** Why a row needs the instructor's eyes; shown beside the Manual review label. */
export const MANUAL_REVIEW_REASON =
  "Original solved after the worked solution; the record cannot show whether a similar problem was available, so the Start over fallback is yours to judge.";

/**
 * When a similar problem may be started for an origin session that is not
 * yet solved: the student has made at least FULL_CREDIT_VALID_ATTEMPT_LIMIT
 * valid answer attempts on the question (across every published session, so
 * Start over neither helps nor hurts) and the origin session has the worked
 * solution fully revealed. A solved or completed origin qualifies as before.
 *
 * The database trigger in migration 025 enforces the same rule; keep the two
 * in step. The migration test runs both over one case table.
 */
export type SimilarProblemOriginInput = {
  origin: {
    practiceContext?: "published" | "reserve_practice";
    questionId: string;
    revealedSteps: number;
    solved?: boolean;
    status?: string;
  };
  /** Solution steps of the origin's pinned question version. */
  stepCount: number;
  /** Every session the student owns, with their recorded attempts. */
  studentSessions: Array<{
    attempts: ValidAnswerAttemptLike[];
    practiceContext?: "published" | "reserve_practice";
    questionId: string;
  }>;
};

export function similarProblemOriginQualifies({
  origin,
  stepCount,
  studentSessions,
}: SimilarProblemOriginInput) {
  if (origin.solved || origin.status === "completed") {
    return true;
  }
  if ((origin.practiceContext ?? "published") !== "published") {
    return false;
  }
  if (stepCount === 0 || origin.revealedSteps < stepCount) {
    return false;
  }
  const validAttempts = studentSessions
    .filter(
      (session) =>
        session.questionId === origin.questionId &&
        (session.practiceContext ?? "published") === "published",
    )
    .reduce(
      (total, session) =>
        total + session.attempts.filter(isValidAnswerAttempt).length,
      0,
    );
  return validAttempts >= FULL_CREDIT_VALID_ATTEMPT_LIMIT;
}
