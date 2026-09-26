"use client";

import Link from "next/link";
import { ChevronDown, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const UPLOAD_PATH = "/professor/upload";

/**
 * Three ways in, one destination: everything a professor writes, pastes, or
 * generates lands in the review queue as `needs_review`. The menu says so
 * rather than implying that writing a question publishes it.
 */
export function AddQuestionMenu({
  onWriteItMyself,
}: {
  onWriteItMyself: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button">
          <Plus aria-hidden="true" />
          Add question
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Every route lands in Needs review</DropdownMenuLabel>
        <DropdownMenuItem onSelect={onWriteItMyself}>
          Write it myself
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={UPLOAD_PATH}>Paste LaTeX or upload a file</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={UPLOAD_PATH}>Generate from course material</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
