import type { InstructorStudentRosterIdentity } from "@/lib/types";

/**
 * A student's display name on the Students page, or the reason there is none.
 * A student with no name to show is told apart from one whose name has not
 * been resolved, so an instructor can tell an absent account from a name that
 * is simply not on this render.
 */
export function StudentName({
  identity,
}: {
  identity?: InstructorStudentRosterIdentity;
}) {
  if (!identity) {
    return <span className="text-sm text-muted-foreground">Name hidden</span>;
  }

  if (identity.status === "identified") {
    return (
      <span className="text-sm font-medium break-words">
        {identity.displayName}
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
  unavailable: "Name temporarily unavailable",
  unlinked: "No longer has an account",
} as const;
