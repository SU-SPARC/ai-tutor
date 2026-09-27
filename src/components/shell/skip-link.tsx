/**
 * The first focusable element on every page. Hidden until focused, then it
 * sits over the header's left edge. `ThreeColumn` (and every page that renders
 * its own `<main>`) must give the main column `id="main-content"`.
 */
export const MAIN_CONTENT_ID = "main-content";

export function SkipLink({ targetId = MAIN_CONTENT_ID }: { targetId?: string }) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only rounded-control bg-azure-500 px-4 py-2 font-medium text-on-fill focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus-ring"
    >
      Skip to content
    </a>
  );
}
