import "server-only";

import { MEANINGFUL_TUTOR_SESSION_SQL } from "@/lib/tutor/session-engagement";

/**
 * One digest function for every owner expression, so a student's key is the
 * same whether it was derived from a session row or from the account itself.
 */
function ownerDigestSql(ownerExpression: string) {
  return `
  encode(
    sha256(
      convert_to(
        ${ownerExpression},
        'UTF8'
      )
    ),
    'hex'
  )
`;
}

/**
 * Instructor analytics expose only a digest of a session owner. Prefixing the
 * two ownership namespaces prevents an authenticated id from colliding with an
 * anonymous cookie subject before hashing.
 */
export const STUDENT_KEY_SQL = ownerDigestSql(`
        case
          when s.user_id is not null then 'user:' || s.user_id
          else 'anon:' || s.anonymous_user_id
        end`);

/**
 * `user_roles` is the database projection of the authoritative Clerk role.
 * Revoked and expired grants do not confer current professor access.
 */
function currentProfessorGrantSql(userIdExpression: string) {
  return `
  exists (
    select 1
    from user_roles analytics_professor_role
    where analytics_professor_role.user_id = ${userIdExpression}
      and analytics_professor_role.role_id = 'professor'
      and analytics_professor_role.revoked_at is null
      and (
        analytics_professor_role.expires_at is null
        or analytics_professor_role.expires_at > now()
      )
  )
`;
}

export const PROFESSOR_OWNED_SESSION_SQL = currentProfessorGrantSql("s.user_id");

/** Engaged anonymous/non-professor sessions form the learning population. */
export const ANALYTICS_STUDENT_SESSION_FILTER_SQL = `
  not (${PROFESSOR_OWNED_SESSION_SQL})
  and ${MEANINGFUL_TUTOR_SESSION_SQL}
`;

/**
 * The signed-in student roster: every human account that can currently sign
 * in and holds no current professor grant. Signing in is what creates the
 * `users` row, so a student is on the roster from their first sign-in, before
 * any practice. System actors, disabled and deleted accounts, and staff are
 * not students. Only the account id is read, and it is digested with the same
 * `'user:' || id` input that a session produces, so a student keeps one
 * pseudonym before and after their first practice.
 */
export const STUDENT_ACCOUNTS_CTE = `
  student_accounts as (
    select
      ${ownerDigestSql("'user:' || u.id")} as student_key,
      u.id as user_id
    from users u
    where u.user_type = 'human'
      and u.status = 'active'
      and not (${currentProfessorGrantSql("u.id")})
  )
`;
