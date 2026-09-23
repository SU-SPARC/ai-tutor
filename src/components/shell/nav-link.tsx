"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

function isActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * A header nav word that knows whether it is the current section. The only
 * client island in the header, so the rest of the shell can stay a server
 * component and read the principal directly.
 */
export function NavLink({
  href,
  label,
  title,
}: {
  href: string;
  label: string;
  title?: string;
}) {
  const pathname = usePathname() ?? "/";
  const active = isActive(pathname, href);

  return (
    <Link
      href={href}
      title={title}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        active
          ? "bg-indigo-100 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {label}
    </Link>
  );
}
