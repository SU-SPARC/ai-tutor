"use client";

import { ChevronDown, Copy } from "lucide-react";

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
 * Blueprint S3 rule 5: copying a released set to another section is the same
 * staged-then-reviewed operation as any other release, just computed for the
 * professor. Nothing is written here — picking a section only opens the review
 * dialog pointed at that section.
 *
 * It is disabled while changes are staged, because a copy commits against the
 * set that is stored, not the one on screen, and applying it would silently
 * throw the professor's staging away.
 */
export function CopyToSectionMenu({
  disabled,
  onSelect,
  sections,
}: {
  disabled: boolean;
  onSelect: (targetSectionId: SectionId) => void;
  sections: CourseSection[];
}) {
  if (sections.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          disabled={disabled}
          size="sm"
          title={
            disabled ? "Review or discard the staged changes first." : undefined
          }
          type="button"
          variant="secondary"
        >
          <Copy aria-hidden="true" />
          Copy to
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel>Copy this released set to</DropdownMenuLabel>
        {sections.map((section) => (
          <DropdownMenuItem
            key={section.id}
            onSelect={() => onSelect(section.id)}
          >
            {sectionName(section)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
