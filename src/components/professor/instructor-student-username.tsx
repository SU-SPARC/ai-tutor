import type { InstructorStudentRosterIdentity } from "@/lib/types";

/**
 * A student's username on the Students page, or the reason there is none. An
 * account that holds no username is told apart from a student with no account
 * and from a username that has not been resolved, so an instructor can tell
 * an absent value from a lookup that did not happen.
 *
 * Usernames are mono (they are identifiers, and `l`/`1` must not blur); the
 * reasons are plain muted text so they never read as a username.
 */
export function StudentUsername({
  identity,
}: {
  identity?: InstructorStudentRosterIdentity;
}) {
  if (!identity) {
    return <span className="text-ink-muted">Username hidden</span>;
  }

  if (identity.status === "identified") {
    return identity.username ? (
      <span className="font-mono break-all text-ink">{identity.username}</span>
    ) : (
      <span className="text-ink-muted">Username unavailable</span>
    );
  }

  return <span className="text-ink-muted">{MESSAGES[identity.status]}</span>;
}

const MESSAGES = {
  anonymous: "No account: practiced without signing in",
  unavailable: "Username temporarily unavailable",
  unlinked: "No longer has an account",
} as const;
