import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A native `<select>` styled to match `Input`.
 *
 * Deliberately NOT a Radix listbox: several panels are covered by tests that
 * render with `renderToStaticMarkup` and assert on native
 * `<option value="...">` markup. Native semantics also give phones their own
 * picker and forms their submission for free.
 *
 * The browser's caret is kept, so it follows the per-theme `color-scheme`.
 * The string works on its own, applied to a bare `<select>`.
 */
const nativeSelectClassName =
  "flex h-10 w-full min-w-0 rounded-control border border-input bg-sheet px-3 py-2 text-base text-ink transition-[border-color] duration-fast ease-out hover:border-ink-muted focus-visible:border-azure-500 focus-ring pointer-coarse:h-11 aria-invalid:border-red-500 disabled:cursor-not-allowed disabled:bg-surface-tint disabled:opacity-60"

function NativeSelect({
  className,
  invalid,
  ...props
}: React.ComponentProps<"select"> & { invalid?: boolean }) {
  return (
    <select
      data-slot="native-select"
      {...props}
      aria-invalid={invalid ? true : props["aria-invalid"]}
      className={cn(nativeSelectClassName, className)}
    />
  )
}

export { NativeSelect, nativeSelectClassName }
