import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Legacy label chip, restyled to match `StatusChip` (6px, wash + dark text).
 * Prefer `StatusChip` for lifecycle/verdict states and `MasteryChip` for
 * mastery; keep Badge for neutral tags. Variants map onto the ramps:
 * default azure, secondary neutral, success green, warning amber (hint
 * colour: avoid for anything that is not a hint), destructive red, cta mint.
 */
const badgeVariants = cva(
  "inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-chip px-2 chip-text whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-azure-100 text-azure-700",
        secondary: "bg-surface-tint text-ink",
        destructive: "bg-red-100 text-red-700",
        outline: "border border-rule text-ink",
        success: "bg-green-100 text-green-700",
        warning: "bg-amber-100 text-amber-700",
        cta: "bg-mint text-mint-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
