import "server-only";

import { MEANINGFUL_TUTOR_SESSION_SQL } from "@/lib/tutor/session-engagement";

/**
 * Instructor analytics expose only a digest of a session owner. Prefixing the
 * two ownership namespaces prevents an authenticated id from colliding with an
 * anonymous cookie subject before hashing.
 */
export const STUDENT_KEY_SQL = `
  encode(
    sha256(
      convert_to(
        case
          when s.user_id is not null then 'user:' || s.user_id
          else 'anon:' || s.anonymous_user_id
        end,
        'UTF8'
      )
    ),
    'hex'
  )
`;

/**
 * `user_roles` is the database projection of the authoritative Clerk role.
 * Revoked and expired grants do not confer current professor access.
 */
export const PROFESSOR_OWNED_SESSION_SQL = `
  exists (
    select 1
    from user_roles analytics_professor_role
    where analytics_professor_role.user_id = s.user_id
      and analytics_professor_role.role_id = 'professor'
      and analytics_professor_role.revoked_at is null
      and (
        analytics_professor_role.expires_at is null
        or analytics_professor_role.expires_at > now()
      )
  )
`;

/** Engaged anonymous/non-professor sessions form the learning population. */
export const ANALYTICS_STUDENT_SESSION_FILTER_SQL = `
  not (${PROFESSOR_OWNED_SESSION_SQL})
  and ${MEANINGFUL_TUTOR_SESSION_SQL}
`;
