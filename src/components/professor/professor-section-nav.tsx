"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

type SectionItem = {
  href: string;
  label: string;
};

/**
 * The professor sections, in workflow order rather than alphabetical: what
 * arrives, what needs a decision, what has been decided, what students can
 * reach. Import/export is deliberately not here — it is an occasional
 * administrative action, not a stop in the review workflow.
 */
const SECTIONS: SectionItem[] = [
  { href: "/professor", label: "Overview" },
  { href: "/professor/review", label: "Review queue" },
  { href: "/professor/questions", label: "Question lifecycle" },
  { href: "/professor/availability", label: "Student availability" },
  { href: "/professor/upload", label: "Uploads" },
  { href: "/professor/analytics", label: "Analytics" },
];

function isActive(pathname: string, href: string) {
  if (href === "/professor") {
    return pathname === "/professor";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ProfessorSectionNav() {
  const pathname = usePathname() ?? "/professor";

  return (
    <nav
      aria-label="Professor sections"
      className="flex flex-wrap items-center gap-1 border-b pb-3 text-sm"
    >
      {SECTIONS.map((section) => {
        const active = isActive(pathname, section.href);
        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {section.label}
          </Link>
        );
      })}
      <Link
        href="/professor/content-transfer"
        aria-current={
          isActive(pathname, "/professor/content-transfer") ? "page" : undefined
        }
        className={cn(
          "ml-auto inline-flex items-center gap-2 rounded-md px-3 py-1.5 font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          isActive(pathname, "/professor/content-transfer")
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        )}
      >
        Import &amp; export
      </Link>
    </nav>
  );
}
