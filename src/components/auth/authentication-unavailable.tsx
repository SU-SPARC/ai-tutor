import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * Shown on /sign-in and /sign-up when this environment has no sign-in set up.
 * A sheet-style panel; the page supplies the surrounding `<main>`.
 */
export function AuthenticationUnavailable() {
  return (
    <section className="sheet-shadow flex w-full flex-col gap-4 rounded-panel bg-sheet p-6 sm:p-8">
      <h1 className="type-h1 text-ink">{"Sign-in isn't set up here"}</h1>
      <p className="type-body max-w-prose text-ink-muted">
        You can still practice as a guest; progress stays in this browser.
      </p>
      <div>
        <Button asChild>
          <Link href="/">Go to the home page</Link>
        </Button>
      </div>
    </section>
  );
}
