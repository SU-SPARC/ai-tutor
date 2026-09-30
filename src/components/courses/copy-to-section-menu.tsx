"use client";

import { ChevronDown } from "lucide-react";

import { sectionName } from "@/components/courses/course-status";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CourseSection, SectionId } from "@/lib/courses/types";

/**
 * "Make another section match this one…": gives another section exactly the
 * same questions, which can also hide that section's extra ones. Nothing is
 * written here — picking a section only opens the check-before-saving dialog
 * pointed at that section, which lists every question shown and hidden.
 *
 * It is off while changes are waiting, because it works from what is saved,
 * not what is on screen. The reason is printed beside it, not in a tooltip.
 */
export function CopyToSectionMenu({
  disabled,
  onSelect,
  sections,
  sourceLabel,
}: {
  disabled: boolean;
  onSelect: (targetSectionId: SectionId) => void;
  sections: CourseSection[];
  /** Already in words: "Section 1". */
  sourceLabel: string;
}) {
  if (sections.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-describedby={disabled ? "copy-to-disabled-reason" : undefined}
            className="min-h-11"
            disabled={disabled}
            type="button"
            variant="outline"
          >
            Make another section match this one…
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-64">
          <DropdownMenuLabel className="type-body">
            Give this section exactly the same questions as {sourceLabel}:
          </DropdownMenuLabel>
          {sections.map((section) => (
            <DropdownMenuItem
              className="min-h-11"
              key={section.id}
              onSelect={() => onSelect(section.id)}
            >
              {sectionName(section)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {disabled ? (
        <p className="type-small text-ink" id="copy-to-disabled-reason">
          Save or discard your changes first.
        </p>
      ) : null}
    </div>
  );
}
