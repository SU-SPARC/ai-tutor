import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { LoaderCircle } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * The one button. Pick the variant by what the action is, not how loud it
 * should look:
 * - `primary` (alias `default`): the page's main action, azure.
 * - `cta`: mint fill with ink text. ONLY Check answer, Start practicing /
 *   Continue, and Join. One per screen.
 * - `secondary`: a second action next to a primary.
 * - `outline`: a quiet control that still needs a visible boundary.
 * - `ghost`: toolbar and icon buttons.
 * - `link`: inline text action.
 * - `destructive`: deletes or retires something. Confirm or offer Undo.
 *
 * Sizes: `sm` 32, `md` (alias `default`) 40, `lg` 48, `icon` 40 square,
 * `icon-sm` 32 square. Small sizes grow an invisible 44px hit area on touch
 * screens, so layouts do not change.
 *
 * `loading` swaps the label for a spinner without changing the width, sets
 * `aria-busy` and disables the button. It is ignored with `asChild`.
 */
const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-medium whitespace-nowrap select-none",
    "transition-[background-color,color,border-color,transform] duration-fast ease-out active:scale-98",
    "focus-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        default: "bg-azure-500 text-on-fill hover:bg-azure-700",
        primary: "bg-azure-500 text-on-fill hover:bg-azure-700",
        cta: "bg-mint text-mint-foreground hover:bg-mint-hover",
        secondary: "bg-surface-tint text-ink hover:bg-hover",
        outline:
          "border border-input bg-transparent text-ink hover:border-ink-muted hover:bg-hover",
        ghost: "bg-transparent text-ink hover:bg-hover",
        link: "bg-transparent text-azure-500 underline-offset-4 hover:text-azure-700 hover:underline active:scale-100",
        destructive: "bg-red-500 text-on-fill hover:bg-red-700",
      },
      size: {
        default: "h-10 px-4 text-base",
        md: "h-10 px-4 text-base",
        sm: "h-8 px-3 text-sm pointer-coarse:after:absolute pointer-coarse:after:-inset-1.5",
        lg: "h-12 px-6 text-base",
        icon: "size-10 [&_svg:not([class*='size-'])]:size-5",
        "icon-sm":
          "size-8 pointer-coarse:after:absolute pointer-coarse:after:-inset-1.5",
      },
    },
    compoundVariants: [
      { variant: "link", size: ["default", "md", "sm", "lg"], className: "h-auto px-0" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** Render the single child (e.g. a `<Link>`) with button styling. */
    asChild?: boolean
    /** Show a spinner in place of the label and block clicks. */
    loading?: boolean
  }

function Button({
  asChild = false,
  className,
  size,
  variant,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, className }))

  if (asChild) {
    return (
      <Slot data-slot="button" className={classes} {...props}>
        {children}
      </Slot>
    )
  }

  // Attribute order is deliberate: `disabled` is rendered last so static
  // markup reads `disabled="">Label`, which UI tests assert on.
  return (
    <button
      data-slot="button"
      {...props}
      className={classes}
      data-loading={loading ? "true" : undefined}
      aria-busy={loading ? true : undefined}
      disabled={disabled || loading}
    >
      {loading ? (
        <>
          <span className="invisible inline-flex items-center gap-2">
            {children}
          </span>
          <span className="absolute inset-0 inline-flex items-center justify-center">
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          </span>
        </>
      ) : (
        children
      )}
    </button>
  )
}

export { Button, buttonVariants }
export type { ButtonProps }
