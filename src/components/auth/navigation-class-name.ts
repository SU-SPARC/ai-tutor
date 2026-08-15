/**
 * Shared styling for the plain text links in the header account cluster.
 * Lives on its own so `account-actions` (server) and
 * `current-page-sign-in-link` (client) stay in sync.
 */
export const navigationClassName =
  "rounded-sm text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
