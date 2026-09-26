"use client";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { NavLink } from "@/components/shell/nav-link";
import {
  PROFESSOR_ADMIN_SECTIONS,
  PROFESSOR_NAV,
  PROFESSOR_SECTIONS,
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
 * every workspace section (the rail is hidden at these widths), then the
 * theme choice and the environment line. A right-hand sheet dialog.
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

  const primary = role === "professor" ? PROFESSOR_NAV : STUDENT_NAV;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Open menu" className="lg:hidden">
          <Menu aria-hidden="true" />
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
          <nav aria-label="Workspace" className="flex flex-col gap-1">
            <p className="type-label px-3 pb-1">Workspace</p>
            {[...PROFESSOR_SECTIONS, ...PROFESSOR_ADMIN_SECTIONS].map((section) => (
              <NavLink
                key={section.href}
                href={section.href}
                label={section.label}
                prefetch={section.prefetch}
                layout="row"
                match="section"
              />
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
