import Link from "next/link";

/**
 * Shown on /sign-in and /sign-up when Clerk has no credentials. A sheet-style
 * panel; the page supplies the surrounding `<main>`.
 */
export function AuthenticationUnavailable() {
  return (
    <section className="sheet-shadow flex w-full flex-col gap-4 rounded-panel bg-sheet p-6 sm:p-8">
      <h1 className="type-h1 text-ink">Account sign-in is not configured</h1>
      <p className="type-body max-w-prose text-ink-muted">
        This environment has no Clerk authentication credentials. It will not
        simulate a real account or accept a local password.
      </p>
      <p className="type-body max-w-prose text-ink-muted">
        Anonymous practice remains available only when the pilot is enabled,
        and its progress cannot follow you to another device until you sign in
        through a configured environment.
      </p>
      <p>
        <Link
          className="rounded-xs font-medium text-azure-500 underline underline-offset-4 hover:text-azure-700 focus-ring"
          href="/"
        >
          Return home
        </Link>
      </p>
    </section>
  );
}
