import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A form label. 16px, 500, ink. Mark optional fields in words, never with a
 * red asterisk.
 */
function Label({
  className,
  optional = false,
  children,
  ...props
}: React.ComponentProps<"label"> & { optional?: boolean }) {
  return (
    <label
      data-slot="label"
      className={cn("type-body-strong text-ink", className)}
      {...props}
    >
      {children}
      {optional ? (
        <span className="font-normal text-ink-muted"> (optional)</span>
      ) : null}
    </label>
  )
}

type FieldProps = {
  /** Visible label text. */
  label: React.ReactNode
  /** Helper line under the control: the expected format, one sentence. */
  description?: React.ReactNode
  /** Error line; also sets `aria-invalid` on the control. Say what to do. */
  error?: React.ReactNode
  /** Adds "(optional)" after the label. */
  optional?: boolean
  /** Control id; generated when omitted. */
  id?: string
  /** Exactly one control element (Input, Textarea, NativeSelect …). */
  children: React.ReactElement<Record<string, unknown>>
  /**
   * A control that sits beside the input on the same row, such as the
   * [Join] button next to the section code. The input takes the free width.
   */
  trailing?: React.ReactNode
  className?: string
}

/**
 * Label + control + helper + error, with the ids wired: the control gets
 * `id`, `aria-describedby` (helper and error) and `aria-invalid` when there is
 * an error. Use it for every labelled form control so no page hand-rolls this.
 * The error line is a polite live region that stays in the DOM (empty when
 * there is no error), so a message that appears after blur or submit is
 * announced.
 *
 * ```tsx
 * <Field label="Section code" description="6 characters, from your professor" error={error}>
 *   <Input name="code" mono autoComplete="off" />
 * </Field>
 * ```
 */
function Field({
  label,
  description,
  error,
  optional = false,
  id,
  children,
  trailing,
  className,
}: FieldProps) {
  const reactId = React.useId()
  const controlId = id ?? (children.props.id as string | undefined) ?? `${reactId}-control`
  const descriptionId = description ? `${controlId}-description` : undefined
  const errorId = `${controlId}-error`
  const describedBy =
    [
      children.props["aria-describedby"] as string | undefined,
      descriptionId,
      error ? errorId : undefined,
    ]
      .filter(Boolean)
      .join(" ") || undefined

  const control = React.cloneElement(children, {
    id: controlId,
    "aria-describedby": describedBy,
    ...(error ? { "aria-invalid": true } : {}),
  })

  return (
    <div data-slot="field" className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={controlId} optional={optional}>
        {label}
      </Label>
      {trailing ? (
        <div data-slot="field-row" className="flex items-start gap-2">
          <div className="min-w-0 flex-1">{control}</div>
          {trailing}
        </div>
      ) : (
        control
      )}
      {description ? (
        <p id={descriptionId} className="type-small text-ink-muted">
          {description}
        </p>
      ) : null}
      {/* Always rendered so the message is announced when it appears; the
          negative margin cancels the column gap while it is empty. */}
      <p
        id={errorId}
        aria-live="polite"
        className="type-small font-medium text-red-700 empty:-mt-2"
      >
        {error}
      </p>
    </div>
  )
}

export { Field, Label }
export type { FieldProps }
