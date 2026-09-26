"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Radix dialog: focus is trapped and restored, Escape and a click on the
 * scrim close it, the page behind is inert.
 *
 * `DialogContent side`:
 * - `center` (default): confirmations and short forms. `size` sm | md | lg.
 * - `right` / `left`: a full-height panel (the mobile nav, a preview).
 *   `width` sm (24rem, default) | md (30rem) | lg (36rem).
 * - `bottom`: a phone bottom sheet with a handle (the tutor on phones).
 *
 * Focus return: on close, focus goes to `returnFocusTo` when given, else to
 * the element that had focus when the dialog opened (the button of a
 * dropdown menu when it was opened from a menu item), else to the
 * `DialogTrigger`. Dialogs opened from a row, a menu item or the URL need no
 * trigger to get this.
 *
 * Every dialog needs a `DialogTitle` (use `className="sr-only"` if the design
 * has no visible title).
 */
const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-scrim",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:duration-base data-[state=closed]:duration-fast",
        className,
      )}
      {...props}
    />
  )
}

type DialogSide = "center" | "right" | "left" | "bottom"
type DialogSize = "sm" | "md" | "lg"

const SIDE_CLASSES: Record<DialogSide, string> = {
  center:
    "top-1/2 left-1/2 max-h-[85svh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-panel data-[state=open]:zoom-in-97 data-[state=closed]:zoom-out-97",
  right:
    "inset-y-0 right-0 h-full data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
  left: "inset-y-0 left-0 h-full data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left",
  bottom:
    "inset-x-0 bottom-0 max-h-[85svh] rounded-t-panel pb-safe data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
}

const SIZE_CLASSES: Record<DialogSize, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-3xl",
}

/** Panel widths for `side="right"` / `"left"`; never wider than the screen minus a 3rem scrim. */
const WIDTH_CLASSES: Record<DialogSize, string> = {
  sm: "w-[min(24rem,calc(100vw-3rem))]",
  md: "w-[min(30rem,calc(100vw-3rem))]",
  lg: "w-[min(36rem,calc(100vw-3rem))]",
}

type DialogContentProps = React.ComponentProps<typeof DialogPrimitive.Content> & {
  side?: DialogSide
  /** Width of a centred dialog. */
  size?: DialogSize
  /** Width of a `right` / `left` panel (default sm). */
  width?: DialogSize
  /** Render the top-right close button (default true). */
  showClose?: boolean
  /** Where focus goes when the dialog closes (see the note above). */
  returnFocusTo?: React.RefObject<HTMLElement | null>
}

/** The element focus should return to: a menu item resolves to its menu's button. */
function focusedOpener(): HTMLElement | null {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || active === document.body) {
    return null
  }
  const menu = active.closest<HTMLElement>('[role="menu"][id]')
  const menuTrigger = menu
    ? document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(menu.id)}"]`)
    : null
  return menuTrigger ?? active
}

function DialogContent({
  className,
  children,
  side = "center",
  size = "md",
  width = "sm",
  showClose = true,
  returnFocusTo,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: DialogContentProps) {
  const openerRef = React.useRef<HTMLElement | null>(null)

  const handleOpenAutoFocus = (event: Event) => {
    // Radix calls this before it moves focus, so the opener is still active.
    openerRef.current = focusedOpener()
    onOpenAutoFocus?.(event)
  }

  const handleCloseAutoFocus = (event: Event) => {
    onCloseAutoFocus?.(event)
    const opener = openerRef.current
    openerRef.current = null
    if (event.defaultPrevented) {
      return
    }
    const target = returnFocusTo?.current ?? opener
    if (target && target.isConnected) {
      event.preventDefault()
      target.focus()
    }
  }

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-side={side}
        // Radix moves focus to the panel on open; the panel is a region,
        // not a control, so `outline-none` here is correct. Every control
        // inside it keeps the shared focus ring.
        className={cn(
          "fixed z-50 flex flex-col overflow-hidden bg-sheet text-ink outline-none overscroll-contain",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          "data-[state=open]:duration-base data-[state=closed]:duration-fast data-[state=open]:ease-drawer",
          SIDE_CLASSES[side],
          side === "center" ? SIZE_CLASSES[size] : undefined,
          side === "right" || side === "left" ? WIDTH_CLASSES[width] : undefined,
          className,
        )}
        onOpenAutoFocus={handleOpenAutoFocus}
        onCloseAutoFocus={handleCloseAutoFocus}
        {...props}
      >
        {side === "bottom" ? (
          <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-rule" />
        ) : null}
        {children}
        {showClose ? (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            aria-label="Close"
            className="absolute top-3 right-3 inline-flex size-10 items-center justify-center rounded-control text-ink-muted transition-colors duration-fast hover:bg-hover hover:text-ink focus-ring"
          >
            <X aria-hidden="true" className="size-5" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 px-6 pt-6 pr-14 pb-4", className)}
      {...props}
    />
  )
}

/** Scrolls when the content is taller than the dialog. */
function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn("min-h-0 flex-1 overflow-y-auto px-6 pb-6", className)}
      {...props}
    />
  )
}

/** The commit row: context on the left, actions on the right. */
function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-3 border-t border-rule bg-surface-tint px-6 py-4 sm:flex-row sm:items-center sm:justify-end",
        className,
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("type-h2 text-ink", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("type-body text-ink-muted", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
export type { DialogContentProps, DialogSide, DialogSize }
