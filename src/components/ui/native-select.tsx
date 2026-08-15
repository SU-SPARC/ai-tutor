import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A native `<select>` styled to match `Input` and the rest of the system.
 *
 * This is deliberately NOT the Radix-based shadcn Select: several panels are
 * covered by tests that render them with `renderToStaticMarkup` and assert on
 * native `<option value="...">` markup, which a portal-and-listbox
 * implementation does not produce. Native semantics also give us mobile
 * pickers and form submission for free.
 *
 * The browser's own caret is kept rather than reproduced with a background
 * image, so it follows the `color-scheme` we set per theme in `globals.css`.
 * That also means this string works on its own, applied to a bare `<select>`.
 */
const nativeSelectClassName =
  "flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/30 disabled:cursor-not-allowed disabled:opacity-50"

function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(nativeSelectClassName, className)}
      {...props}
    />
  )
}

export { NativeSelect, nativeSelectClassName }
