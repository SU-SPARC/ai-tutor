"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isNavActive, isSectionActive } from "@/components/shell/nav-config";
import { cn } from "@/lib/utils";

/**
 * A nav word that knows whether it is the current section. Active = azure-100
 * wash + azure-700 text + `aria-current="page"`.
 *
 * `layout="row"` is the full-width version used inside the phone menu.
 */
export function NavLink({
  href,
  label,
  title,
  prefetch,
  layout = "inline",
  match = "prefix",
  className,
}: {
  href: string;
  label: string;
  title?: string;
  prefetch?: false;
  layout?: "inline" | "row";
  /** "section": workspace rows, where Overview (/professor) matches exactly. */
  match?: "prefix" | "section";
  className?: string;
}) {
  const pathname = usePathname() ?? "/";
  const active =
    match === "section"
      ? isSectionActive(pathname, href)
      : isNavActive(pathname, href);

  return (
    <Link
      href={href}
      title={title}
      prefetch={prefetch}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex items-center rounded-control font-medium transition-colors duration-fast ease-out focus-ring",
        layout === "inline"
          ? "h-9 px-3 text-base pointer-coarse:h-11"
          : "h-11 w-full px-3 text-base",
        active
          ? "bg-azure-100 text-azure-700"
          : "text-ink-muted hover:bg-hover hover:text-ink",
        className,
      )}
    >
      {label}
    </Link>
  );
}
