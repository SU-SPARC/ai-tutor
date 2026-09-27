"use client";

import "./globals.css";

/**
 * Replaces the root layout when the layout itself fails, so it cannot use the
 * header, fonts or providers. It still reads the tokens from globals.css and
 * follows the OS theme.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main
          id="main-content"
          className="flex min-h-svh items-start justify-center bg-surface px-4 py-16 sm:items-center"
        >
          <section className="sheet-shadow flex w-full max-w-lg flex-col gap-4 rounded-panel bg-sheet p-6 sm:p-8">
            <p className="type-mono text-ink-muted">ProbStat Tutor</p>
            <h1 className="type-h1 text-ink">The tutor could not start</h1>
            <p className="type-body text-ink-muted">
              Something failed before the page could load. Try again; if it
              keeps happening, come back in a few minutes.
            </p>
            <div className="mt-2 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={reset}
                className="inline-flex h-10 items-center rounded-control bg-azure-500 px-4 font-medium text-on-fill hover:bg-azure-700 focus-ring"
              >
                Try again
              </button>
              {/* A plain anchor: the router may be what failed. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/"
                className="inline-flex h-10 items-center rounded-control border border-input px-4 font-medium text-ink hover:bg-hover focus-ring"
              >
                Home
              </a>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
