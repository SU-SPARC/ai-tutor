export const APPLICATION_ROLES = ["student", "professor"] as const;

export type ApplicationRole = (typeof APPLICATION_ROLES)[number];

export function applicationRoleFromPublicMetadata(
  publicMetadata: unknown,
): ApplicationRole {
  if (
    publicMetadata &&
    typeof publicMetadata === "object" &&
    !Array.isArray(publicMetadata) &&
    (publicMetadata as { role?: unknown }).role === "professor"
  ) {
    return "professor";
  }

  return "student";
}
