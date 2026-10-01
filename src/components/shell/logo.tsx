import Image from "next/image";

import { cn } from "@/lib/utils";

export type LogoProps = {
  /** `sm` is the 28px header mark; `lg` is the 52px mark on join and sign-in. */
  size?: "sm" | "lg";
  /** Print "AI Tutor" beside the icon. */
  wordmark?: boolean;
  /**
   * Classes for the wordmark only, e.g. `hidden sm:inline` in the header,
   * where the phone bar keeps just the icon.
   */
  wordmarkClassName?: string;
  /** Load the icon eagerly (it is above the fold on every page). */
  priority?: boolean;
  className?: string;
};

const ICON_PX = { sm: 28, lg: 52 } as const;

/**
 * The AI Tutor mark: the gradient icon, optionally with the wordmark in
 * the display serif. The gradient lives only in the icon; the wordmark is
 * plain ink.
 *
 * When the wordmark is printed the icon is decorative (`alt=""`) so the name
 * is read once; on its own the icon carries the name. A wrapping link that
 * sets its own `aria-label` names itself either way.
 */
export function Logo({
  size = "sm",
  wordmark = false,
  wordmarkClassName,
  priority = false,
  className,
}: LogoProps) {
  const px = ICON_PX[size];
  return (
    <span
      data-slot="logo"
      className={cn(
        "inline-flex shrink-0 items-center",
        size === "lg" ? "gap-3" : "gap-2.5",
        className,
      )}
    >
      <Image
        src="/logo.png"
        alt={wordmark ? "" : "AI Tutor"}
        width={px}
        height={px}
        priority={priority}
        className={size === "lg" ? "size-13" : "size-7"}
      />
      {wordmark ? (
        <span
          className={cn(
            "font-display leading-none font-medium text-ink",
            size === "lg" ? "text-2xl" : "text-lg",
            wordmarkClassName,
          )}
        >
          AI Tutor
        </span>
      ) : null}
    </span>
  );
}
