"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { BookOpen } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { ThemeToggle } from "@/components/theme-toggle"
import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

type NavItem = { href: string; label: string }

const NAV_ITEMS: NavItem[] = [
  { href: "/topics", label: "Topics" },
  { href: "/practice", label: "Practice" },
  { href: "/dashboard", label: "Progress" },
]

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function SiteHeader({
  accountControl,
  environmentLabel,
}: {
  accountControl?: ReactNode
  environmentLabel?: "Development" | "Local demo" | "Preview" | "Preview demo"
}) {
  const pathname = usePathname() ?? "/"

  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-6 px-6 py-3">
        <Link href="/" className="flex min-w-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <Image src="/logo.png" alt="Suffolk Probability and Statistics Tutor" width={30} height={30} priority className="size-7" />
          <span className="truncate font-semibold tracking-tight">Suffolk Tutor</span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 text-sm md:flex">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={cn("rounded-md px-3 py-2 font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground")}>
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {environmentLabel ? <Badge variant="outline" className="hidden sm:inline-flex" title={`Non-production environment: ${environmentLabel}`}>{environmentLabel}</Badge> : null}
          {accountControl}
          <ThemeToggle />
        </div>
      </div>
      <nav aria-label="Mobile primary" className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-6 pb-3 md:hidden">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href)
          return <Link key={item.href} href={item.href} className={cn("flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium", active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent")}><BookOpen className="h-3.5 w-3.5" aria-hidden="true" />{item.label}</Link>
        })}
        <Link href="/dashboard" className="sr-only">View progress</Link>
      </nav>
      <div aria-hidden="true" className="brand-gradient-surface h-px w-full opacity-40" />
    </header>
  )
}
