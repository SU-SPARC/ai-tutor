import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The phone/tablet replacement for the rail (pass it as ThreeColumn
 * `mobileTop`): a back link on the left, an optional control on the right
 * (a "Jump to" NativeSelect, a position "3 of 8"). 48px, hairline below.
 */
export function BackBar({
  href,
  label,
  end,
  className,
}: {
  href: string;
  /** Where the link goes, in words: "Conditional probability". */
  label: string;
  end?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="back-bar"
      className={cn(
        "flex h-12 items-center gap-3 border-b border-rule bg-surface px-2 sm:px-4",
        className,
      )}
    >
      <Link
        href={href}
        className="inline-flex h-11 min-w-0 items-center gap-1 rounded-control pr-2 pl-1 font-medium text-ink transition-colors duration-fast hover:bg-hover focus-ring"
      >
        <ChevronLeft aria-hidden="true" className="size-5 shrink-0" />
        <span className="truncate">{label}</span>
      </Link>
      {end ? <div className="ml-auto flex shrink-0 items-center">{end}</div> : null}
    </div>
  );
}
