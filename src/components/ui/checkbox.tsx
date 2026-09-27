"use client"

import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check, Minus } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * A 20px checkbox (Radix: `role="checkbox"`, Space toggles, works inside a
 * `<form>` through a hidden input when it has a `name`). Use it for row
 * selection and opt-ins. Give it a visible label: wrap it with
 * `<CheckboxField label=…>` or point a `<Label htmlFor>` at its `id`.
 * `checked="indeterminate"` renders a dash (the "some rows selected" header).
 */
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative inline-flex size-5 shrink-0 items-center justify-center rounded-xs border border-input bg-sheet text-on-fill",
        "transition-[background-color,border-color] duration-fast ease-out hover:border-ink-muted focus-ring",
        "data-[state=checked]:border-azure-500 data-[state=checked]:bg-azure-500",
        "data-[state=indeterminate]:border-azure-500 data-[state=indeterminate]:bg-azure-500",
        "aria-invalid:border-red-500 disabled:cursor-not-allowed disabled:opacity-50",
        "pointer-coarse:after:absolute pointer-coarse:after:-inset-3",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center"
      >
        {props.checked === "indeterminate" ? (
          <Minus aria-hidden="true" className="size-3.5" strokeWidth={3} />
        ) : (
          <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

type CheckboxFieldProps = React.ComponentProps<typeof CheckboxPrimitive.Root> & {
  /** The visible label. The whole row is the hit target. */
  label: React.ReactNode
  /** One line under the label. */
  description?: React.ReactNode
}

/** Checkbox + label (+ optional description) sharing one hit target. */
function CheckboxField({
  label,
  description,
  id,
  className,
  ...props
}: CheckboxFieldProps) {
  const reactId = React.useId()
  const controlId = id ?? `${reactId}-checkbox`
  const descriptionId = description ? `${controlId}-description` : undefined

  return (
    <div className={cn("flex items-start gap-3", className)}>
      <Checkbox
        id={controlId}
        aria-describedby={descriptionId}
        className="mt-0.5"
        {...props}
      />
      <div className="flex flex-col gap-0.5">
        <label
          htmlFor={controlId}
          className="type-body cursor-pointer text-ink peer-disabled:cursor-not-allowed"
        >
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="type-small text-ink-muted">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export { Checkbox, CheckboxField }
export type { CheckboxFieldProps }
