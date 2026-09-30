/**
 * Ghost sessions let the application be demonstrated on a laptop that has
 * neither Clerk nor a database. The cookie holds nothing but a role name, so
 * the resulting principal is openly synthetic rather than a lookup of a real
 * account, and `GHOST_LOGIN_ENABLED` refuses to turn on in any deployed or
 * Clerk-configured environment.
 *
 * The module deliberately avoids `server-only` and imports the principal type
 * with `import type` so it stays a pure value module: the proxy (which runs
 * outside the server-only boundary) and unit tests can both use it.
 */
import type { AuthenticatedPrincipal } from "@/lib/auth/principal";

export const GHOST_SESSION_COOKIE = "ai-tutor-ghost-session";

export const GHOST_ROLES = ["professor", "student"] as const;

export type GhostRole = (typeof GHOST_ROLES)[number];

export function parseGhostRole(value: unknown): GhostRole | undefined {
  return typeof value === "string" &&
    (GHOST_ROLES as readonly string[]).includes(value)
    ? (value as GhostRole)
    : undefined;
}

/**
 * Ghost identifiers carry their own provenance so any surface that would
 * otherwise reach for Clerk or the database can recognise a demo principal
 * without a second lookup.
 */
export function isGhostUserId(userId: string) {
  return userId.startsWith("ghost:");
}

/**
 * What a student sees for the demo student: the same word the landing and
 * join pages use for practicing without an account.
 */
export const GHOST_STUDENT_DISPLAY_NAME = "Guest";

export function ghostPrincipalFor(role: GhostRole): AuthenticatedPrincipal {
  return {
    kind: "user",
    userId: `ghost:${role}`,
    displayName:
      role === "professor" ? "Ghost Professor" : GHOST_STUDENT_DISPLAY_NAME,
    email: `ghost-${role}@example.invalid`,
    role,
    roles: role === "professor" ? ["student", "professor"] : ["student"],
  };
}
