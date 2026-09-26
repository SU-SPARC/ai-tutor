import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Shared control chrome for Input, Textarea and NativeSelect: sheet fill, a
 * 1px `--input` boundary (>= 3:1), 16px text so iOS never zooms, azure
 * boundary + ring on keyboard focus, red boundary when `aria-invalid`.
 */
export const controlClassName = cn(
  "w-full min-w-0 rounded-control border border-input bg-sheet px-3 text-ink",
  "transition-[border-color] duration-fast ease-out",
  "placeholder:text-ink-muted selection:bg-azure-100",
  "hover:border-ink-muted focus-visible:border-azure-500 focus-ring",
  "aria-invalid:border-red-500",
  "disabled:cursor-not-allowed disabled:bg-surface-tint disabled:opacity-60",
)

type InputProps = React.ComponentProps<"input"> & {
  /** Mono 18px, tabular: the answer field and code fields (join codes). */
  mono?: boolean
  /** Marks the field invalid (`aria-invalid`) and paints the red boundary. */
  invalid?: boolean
}

/** A single-line text control. Label it with `<Field>` or a `<Label>`. */
function Input({ className, type, mono = false, invalid, ...props }: InputProps) {
  return (
    <input
      type={type}
      data-slot="input"
      {...props}
      aria-invalid={invalid ? true : props["aria-invalid"]}
      spellCheck={mono ? false : props.spellCheck}
      className={cn(
        controlClassName,
        "flex h-10 py-2 pointer-coarse:h-11",
        "file:mr-3 file:inline-flex file:h-full file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink",
        mono ? "type-mono-input" : "text-base",
        className,
      )}
    />
  )
}

export { Input }
export type { InputProps }
