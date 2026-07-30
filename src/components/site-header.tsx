"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { GraduationCap } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type NavItem = {
  href: string
  label: string
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home" },
  { href: "/topics", label: "Topics" },
  { href: "/practice", label: "Practice" },
  { href: "/dashboard", label: "Dashboard" },
]

function isActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/"
  }
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function SiteHeader({ demoMode }: { demoMode: boolean }) {
  const pathname = usePathname() ?? "/"

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <GraduationCap className="h-5 w-5 text-primary" />
          <span className="tracking-tight">Suffolk Prob &amp; Stats Tutor</span>
        </Link>

        <nav
          aria-label="Primary"
          className="order-last flex w-full items-center gap-1 text-sm sm:order-none sm:w-auto"
        >
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 font-medium transition-colors",
                  active
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {demoMode ? (
            <Badge variant="secondary" title="Running on seeded public sample content without a database or LLM provider">
              Demo mode
            </Badge>
          ) : null}
          <Link
            href="/professor"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Professor
          </Link>
        </div>
      </div>
    </header>
  )
}
