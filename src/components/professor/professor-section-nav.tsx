"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

import {
  PROFESSOR_ADMIN_SECTIONS,
  PROFESSOR_SECTIONS,
  isSectionActive,
} from "@/components/shell/nav-config";
import { cn } from "@/lib/utils";

/**
 * The workspace sections as one horizontally scrolling row of links, from the
 * same `nav-config` as the rail and the phone menu. The workspace layout no
 * longer renders it (the phone menu carries the sections below 1024); it is
 * kept for any page that wants an in-page strip.
 */
export function ProfessorSectionNav({ className }: { className?: string }) {
  const pathname = usePathname() ?? "/professor";

  return (
    <nav
      aria-label="Professor sections"
      className={cn(
        "-mx-4 flex items-center gap-1 overflow-x-auto border-b border-rule px-4 pb-2 sm:-mx-6 sm:px-6",
        className,
      )}
    >
      {[...PROFESSOR_SECTIONS, ...PROFESSOR_ADMIN_SECTIONS].map((section) => {
        const active = isSectionActive(pathname, section.href);
        return (
          <Link
            key={section.href}
            href={section.href}
            prefetch={section.prefetch}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-9 shrink-0 items-center rounded-control px-3 text-sm font-medium whitespace-nowrap transition-colors duration-fast focus-ring pointer-coarse:h-11",
              active
                ? "bg-azure-100 text-azure-700"
                : "text-ink-muted hover:bg-hover hover:text-ink",
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
