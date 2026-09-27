/**
 * Shared styling for the plain text links in the header account cluster.
 * Lives on its own so `account-actions` (server) and
 * `current-page-sign-in-link` (client) stay in sync.
 */
export const navigationClassName =
  "inline-flex h-9 items-center rounded-control px-3 text-base font-medium text-ink-muted transition-colors duration-fast ease-out hover:bg-hover hover:text-ink focus-ring pointer-coarse:h-11";

/** A row inside the account menu (links and sign-out buttons alike). */
export const accountMenuItemClassName =
  "flex min-h-10 w-full items-center gap-2.5 rounded-control px-3 text-left text-base text-ink transition-colors duration-fast ease-out hover:bg-hover focus-ring -outline-offset-2 pointer-coarse:min-h-11 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-muted";
