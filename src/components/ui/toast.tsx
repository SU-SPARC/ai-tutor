"use client"

import * as React from "react"
import { CircleCheck, CircleX, X } from "lucide-react"

import { cn } from "@/lib/utils"

export type ToastTone = "neutral" | "success" | "error"

export type ToastOptions = {
  /** One short sentence: what happened ("3 questions approved"). */
  title: string
  /** Optional second line. */
  description?: string
  tone?: ToastTone
  /** A single action, typically Undo. Runs once, then the toast closes. */
  action?: { label: string; onClick: () => void }
  /** Milliseconds before it closes; paused while hovered or focused. Default 6000. */
  duration?: number
}

type ToastRecord = ToastOptions & { id: number }

// A tiny module-level store: no provider needed, callable from any client
// component, and the Toaster in the root layout is the single renderer.
// `toasts` is replaced (never mutated) only by `toast` and `dismissToast`, so
// `useSyncExternalStore` sees a stable reference between changes; the server
// snapshot is one shared constant for the same reason.
const EMPTY_TOASTS: ToastRecord[] = []
const listeners = new Set<(toasts: ToastRecord[]) => void>()
let toasts: ToastRecord[] = EMPTY_TOASTS
let nextId = 1

function emit() {
  for (const listener of listeners) {
    listener(toasts)
  }
}

/** Show a toast. Returns its id (for `dismissToast`). */
export function toast(options: ToastOptions) {
  const id = nextId++
  toasts = [...toasts, { ...options, id }].slice(-3)
  emit()
  return id
}

export function dismissToast(id: number) {
  if (!toasts.some((item) => item.id === id)) {
    return
  }
  toasts = toasts.filter((item) => item.id !== id)
  emit()
}

/**
 * `const { toast } = useToast()` — confirmation after a bulk or destructive
 * action, with an optional Undo. Not for errors a user must act on (put those
 * inline next to the control).
 */
export function useToast() {
  return React.useMemo(() => ({ toast, dismiss: dismissToast }), [])
}

function useToasts() {
  return React.useSyncExternalStore(
    (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => toasts,
    () => EMPTY_TOASTS,
  )
}

const TONE_ICON = {
  neutral: null,
  success: CircleCheck,
  error: CircleX,
} as const

function ToastItem({ item }: { item: ToastRecord }) {
  const [paused, setPaused] = React.useState(false)
  const duration = item.duration ?? 6000
  const tone = item.tone ?? "neutral"
  const Icon = TONE_ICON[tone]

  React.useEffect(() => {
    if (paused) {
      return
    }
    const timer = window.setTimeout(() => dismissToast(item.id), duration)
    return () => window.clearTimeout(timer)
  }, [paused, duration, item.id])

  return (
    <li
      data-slot="toast"
      data-tone={tone}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        "pointer-events-auto flex w-full items-start gap-3 rounded-panel bg-ink px-4 py-3 text-surface",
        "animate-in fade-in-0 slide-in-from-bottom-2 duration-base",
      )}
    >
      {Icon ? (
        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="font-medium">{item.title}</p>
        {item.description ? (
          <p className="text-sm opacity-80">{item.description}</p>
        ) : null}
      </div>
      {item.action ? (
        <button
          type="button"
          onClick={() => {
            item.action?.onClick()
            dismissToast(item.id)
          }}
          className="shrink-0 rounded-control px-2 py-1 font-medium underline underline-offset-4 focus-ring"
        >
          {item.action.label}
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismissToast(item.id)}
        className="-mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-control opacity-80 hover:opacity-100 focus-ring"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </li>
  )
}

/**
 * Mounted once in the root layout. Bottom-right on desktop, bottom-centre
 * above any mobile bottom bar on phones. Polite live region.
 */
export function Toaster() {
  const items = useToasts()

  return (
    <section
      aria-label="Notifications"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-[calc(var(--bottom-bar-h)+1rem+env(safe-area-inset-bottom))] z-[70] flex justify-center sm:inset-x-auto sm:right-6 sm:bottom-6 sm:justify-end lg:bottom-6"
    >
      <ol className="flex w-full max-w-sm flex-col gap-2">
        {items.map((item) => (
          <ToastItem key={item.id} item={item} />
        ))}
      </ol>
    </section>
  )
}
