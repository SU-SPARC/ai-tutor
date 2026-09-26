"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import { Monitor, Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useIsHydrated } from "@/lib/use-is-hydrated"
import { cn } from "@/lib/utils"

const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const

/**
 * The header's theme control: one icon button that opens Light / Dark /
 * System. The icon shows the resolved theme.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()

  // The resolved theme is only known on the client, so render a stable
  // placeholder until after hydration to avoid a server/client mismatch.
  const hydrated = useIsHydrated()

  if (!hydrated) {
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label="Change theme"
        disabled
        className={cn("text-ink-muted", className)}
      >
        <Sun aria-hidden="true" />
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Change theme"
          className={cn("text-ink-muted hover:text-ink", className)}
        >
          <Sun aria-hidden="true" className="dark:hidden" />
          <Moon aria-hidden="true" className="hidden dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        <DropdownMenuRadioGroup
          value={theme ?? "system"}
          onValueChange={(value) => setTheme(value)}
        >
          {OPTIONS.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon aria-hidden="true" className="text-ink-muted" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The same choice as a visible three-way radio group, for the phone menu
 * where a nested dropdown would be awkward.
 */
export function ThemeChoice({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const hydrated = useIsHydrated()
  const current = hydrated ? (theme ?? "system") : undefined
  const name = React.useId()

  return (
    <fieldset className={cn("flex flex-col gap-2", className)}>
      <legend className="type-label mb-2">Theme</legend>
      <div className="inline-flex w-full gap-0.5 rounded-control bg-surface-tint p-0.5">
        {OPTIONS.map(({ value, label, Icon }) => (
          <label
            key={value}
            className={cn(
              "relative flex h-10 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xs text-sm font-medium text-ink-muted transition-colors duration-fast",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
              current === value && "bg-sheet text-ink",
            )}
          >
            <input
              type="radio"
              name={name}
              value={value}
              checked={current === value}
              onChange={() => setTheme(value)}
              className="sr-only"
            />
            <Icon aria-hidden="true" className="size-4" />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
