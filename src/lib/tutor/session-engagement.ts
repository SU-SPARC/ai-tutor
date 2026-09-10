import type { TutorSessionRecord } from "@/lib/types";

/**
 * A practice session has a persisted tutoring interaction or durable progress.
 * Attempts store check, hint, solution and full_solution requests (including
 * AI/cache/blocked responses); legacy attempts may have no mode. These are
 * interactions, not necessarily answer attempts or evidence of learning.
 * Counters/completion preserve historical use when interaction rows are absent.
 * Creation, recovery, timestamps, revisions and AI accounting alone do not count.
 * Keep the SQL and record forms equivalent; parity is tested against PostgreSQL.
 */
export function isMeaningfulTutorSession(session: TutorSessionRecord): boolean {
  return (
    session.attempts.length > 0 ||
    (session.attemptCount ?? 0) > 0 ||
    (session.wrongAttemptCount ?? 0) > 0 ||
    session.revealedHints > 0 ||
    session.revealedSteps > 0 ||
    session.solved === true ||
    session.status === "completed"
  );
}

/** Trusted SQL fragment for tutor_sessions aliased as `s`, never user input. */
export const MEANINGFUL_TUTOR_SESSION_SQL = `(
  s.attempt_count > 0
  or s.wrong_attempt_count > 0
  or s.revealed_hints > 0
  or s.revealed_steps > 0
  or s.solved
  or s.status = 'completed'
  or exists (
    select 1 from attempts engagement_attempt
    where engagement_attempt.session_id = s.id
  )
)`;
