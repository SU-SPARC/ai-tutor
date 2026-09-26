import * as React from "react"
import {
  Archive,
  BookOpenCheck,
  Check,
  CircleCheck,
  CircleX,
  Eye,
  Lightbulb,
  PencilLine,
  Send,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"

export type StatusTone =
  | "neutral"
  | "draft"
  | "review"
  | "approved"
  | "published"
  | "released"
  | "correct"
  | "wrong"
  | "hint"
  | "retired"

type ToneSpec = { className: string; icon?: LucideIcon }

/**
 * The source of truth for lifecycle and verdict colours. Change a tone here,
 * never per page.
 *
 * - draft: neutral wash, pencil
 * - review ("Needs review"): azure hairline, eye (waiting on a person)
 * - approved: green wash, check
 * - published: azure wash, book (approved AND in the bank)
 * - released: mint fill, send (students can see it)
 * - correct / wrong: green / red wash with the verdict icons
 * - hint: amber (the only amber in the product)
 * - retired: red wash, archive
 */
export const STATUS_TONES: Record<StatusTone, ToneSpec> = {
  neutral: { className: "bg-surface-tint text-ink-muted" },
  draft: { className: "bg-surface-tint text-ink", icon: PencilLine },
  review: {
    className: "border border-azure-300 bg-sheet text-azure-700",
    icon: Eye,
  },
  approved: { className: "bg-green-100 text-green-700", icon: Check },
  published: { className: "bg-azure-100 text-azure-700", icon: BookOpenCheck },
  released: { className: "bg-mint text-mint-foreground", icon: Send },
  correct: { className: "bg-green-100 text-green-700", icon: CircleCheck },
  wrong: { className: "bg-red-100 text-red-700", icon: CircleX },
  hint: { className: "bg-amber-100 text-amber-700", icon: Lightbulb },
  retired: { className: "bg-red-100 text-red-700", icon: Archive },
}

export type StatusChipProps = Omit<React.ComponentProps<"span">, "children"> & {
  tone: StatusTone
  /** Always shown; colour is never the only signal. */
  label: React.ReactNode
  /** `true` (default) uses the tone's icon, `false` hides it, or pass one. */
  icon?: boolean | LucideIcon
  /** Optional mono count after the label ("Needs review 12"). */
  count?: number
}

/**
 * A rectangular (6px) state chip: 100-step wash, 700-step text, 12px icon.
 * Use for question lifecycle states, verdicts and hint markers. For mastery
 * use `MasteryChip`; for anything else, plain text.
 */
function StatusChip({
  tone,
  label,
  icon = true,
  count,
  className,
  ...props
}: StatusChipProps) {
  const spec = STATUS_TONES[tone]
  const Icon = icon === true ? spec.icon : icon === false ? undefined : icon

  return (
    <span
      data-slot="status-chip"
      data-tone={tone}
      className={cn(
        "inline-flex h-6 w-fit shrink-0 items-center gap-1 rounded-chip px-2 chip-text whitespace-nowrap",
        spec.className,
        className,
      )}
      {...props}
    >
      {Icon ? <Icon aria-hidden="true" className="size-3 shrink-0" strokeWidth={2.25} /> : null}
      {label}
      {count !== undefined ? (
        <span className="font-mono tabular">{count}</span>
      ) : null}
    </span>
  )
}

export { StatusChip }
