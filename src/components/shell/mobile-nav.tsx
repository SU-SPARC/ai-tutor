"use client";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { NavLink } from "@/components/shell/nav-link";
import {
  PROFESSOR_NAV,
  PROFESSOR_SECTION_GROUPS,
  STUDENT_NAV,
} from "@/components/shell/nav-config";
import { ThemeChoice } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * The phone/tablet menu (< 1024): the header's nav words, and for professors
 * every professor page in the rail's groups (the rail is hidden at these
 * widths), then the theme choice and the environment line. A right-hand sheet
 * dialog. The trigger says "Menu" in words, not only with an icon.
 */
export function MobileNav({
  role,
  environmentLabel,
}: {
  role?: "student" | "professor";
  environmentLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  // A professor's "Home" is already the first row of the page list below.
  const primary =
    role === "professor"
      ? PROFESSOR_NAV.filter(
          (item) =>
            !PROFESSOR_SECTION_GROUPS.some((group) =>
              group.sections.some((section) => section.href === item.href),
            ),
        )
      : STUDENT_NAV;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          className="min-h-11 px-3 lg:hidden"
          data-tour={role === "professor" ? "professor-menu" : undefined}
        >
          <Menu aria-hidden="true" className="size-5" />
          Menu
        </Button>
      </DialogTrigger>
      <DialogContent side="right" className="gap-6 overflow-y-auto px-4 pt-5 pb-6">
        <div className="flex flex-col gap-1 pr-12">
          <DialogTitle className="type-h3">Menu</DialogTitle>
          <DialogDescription className="sr-only">
            Site navigation and display settings
          </DialogDescription>
        </div>

        <nav aria-label="Primary" className="flex flex-col gap-1">
          {primary.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              title={item.title}
              layout="row"
            />
          ))}
        </nav>

        {role === "professor" ? (
          <nav aria-label="Professor pages" className="flex flex-col gap-4">
            {PROFESSOR_SECTION_GROUPS.map((group) => (
              <div key={group.heading} className="flex flex-col gap-1">
                <p className="type-small px-3 text-ink-muted">{group.heading}</p>
                {group.sections.map((section) => (
                  <NavLink
                    key={section.href}
                    href={section.href}
                    label={section.label}
                    prefetch={section.prefetch}
                    layout="row"
                    match="section"
                  />
                ))}
              </div>
            ))}
          </nav>
        ) : null}

        <ThemeChoice />

        {environmentLabel ? (
          <p className="type-caption mt-auto" title={`Non-production environment: ${environmentLabel}`}>
            {environmentLabel}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
