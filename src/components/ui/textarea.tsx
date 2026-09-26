import * as React from "react"

import { cn } from "@/lib/utils"
import { controlClassName } from "@/components/ui/input"

type TextareaProps = React.ComponentProps<"textarea"> & {
  /** Marks the field invalid (`aria-invalid`) and paints the red boundary. */
  invalid?: boolean
}

/** Multi-line text: tutor messages, audit notes, question wording. */
function Textarea({ className, invalid, ...props }: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      {...props}
      aria-invalid={invalid ? true : props["aria-invalid"]}
      className={cn(controlClassName, "flex min-h-24 py-2 text-base leading-normal", className)}
    />
  )
}

export { Textarea }
export type { TextareaProps }
