"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type NavItem = {
  href: string;
  label: string;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home" },
  { href: "/topics", label: "Topics" },
  { href: "/practice", label: "Practice" },
  { href: "/dashboard", label: "Dashboard" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader({
  accountControl,
  environmentLabel,
}: {
  accountControl?: ReactNode;
  environmentLabel?: "Development" | "Local demo" | "Preview" | "Preview demo";
}) {
  const pathname = usePathname() ?? "/";

  return (
    <header className="sticky top-0 z-40 bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex w-full max-w-[90rem] flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-md font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Image
            src="/logo.png"
            alt=""
            width={28}
            height={28}
            priority
            className="h-7 w-7"
          />
          <span className="tracking-tight">Suffolk Prob &amp; Stats Tutor</span>
        </Link>

        <nav
          aria-label="Primary"
          className="order-last flex w-full items-center gap-1 text-sm sm:order-none sm:w-auto"
        >
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {environmentLabel ? (
            <Badge
              variant="outline"
              title={`Non-production environment: ${environmentLabel}`}
            >
              {environmentLabel}
            </Badge>
          ) : null}
          {accountControl}
          <ThemeToggle />
        </div>
      </div>

      {/* Hairline echo of the logo gradient, in place of a plain border. */}
      <div
        aria-hidden="true"
        className="brand-gradient-surface h-px w-full opacity-40"
      />
    </header>
  );
}
