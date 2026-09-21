import type { InstructorStudentRosterIdentity } from "@/lib/types";

/**
 * A student's username on the Students page, or the reason there is none. An
 * account that holds no username is told apart from a student with no account
 * and from a username that has not been resolved, so an instructor can tell
 * an absent value from a lookup that did not happen.
 */
export function StudentUsername({
  identity,
}: {
  identity?: InstructorStudentRosterIdentity;
}) {
  if (!identity) {
    return (
      <span className="text-sm text-muted-foreground">Username hidden</span>
    );
  }

  if (identity.status === "identified") {
    return identity.username ? (
      <span className="text-sm font-medium break-all">{identity.username}</span>
    ) : (
      <span className="text-sm text-muted-foreground">
        Username unavailable
      </span>
    );
  }

  return (
    <span className="text-sm text-muted-foreground">
      {MESSAGES[identity.status]}
    </span>
  );
}

const MESSAGES = {
  anonymous: "No account: practised without signing in",
  unavailable: "Username temporarily unavailable",
  unlinked: "No longer has an account",
} as const;
