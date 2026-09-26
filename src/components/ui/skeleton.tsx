import { cn } from "@/lib/utils"

/**
 * A placeholder block shaped like the content that is coming. Compose these
 * into the real layout's shape (see `QuestionSheetSkeleton` for the Sheet);
 * never a centred spinner. The pulse stops under reduced motion.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("animate-pulse rounded-control bg-hover", className)}
      {...props}
    />
  )
}

export { Skeleton }
