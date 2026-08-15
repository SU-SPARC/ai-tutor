"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import { Monitor, Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useIsHydrated } from "@/lib/use-is-hydrated"

const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const

export function ThemeToggle() {
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
        className="text-muted-foreground"
      >
        <Sun className="h-[1.15rem] w-[1.15rem]" aria-hidden="true" />
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
          className="relative text-muted-foreground hover:text-foreground"
        >
          <Sun
            className="h-[1.15rem] w-[1.15rem] scale-100 rotate-0 transition-transform duration-200 dark:scale-0 dark:-rotate-90"
            aria-hidden="true"
          />
          <Moon
            className="absolute h-[1.15rem] w-[1.15rem] scale-0 rotate-90 transition-transform duration-200 dark:scale-100 dark:rotate-0"
            aria-hidden="true"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        {OPTIONS.map(({ value, label, Icon }) => (
          <DropdownMenuItem
            key={value}
            onSelect={() => setTheme(value)}
            className={theme === value ? "bg-accent/60 font-medium" : undefined}
          >
            <Icon aria-hidden="true" />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
