"use client";

import Link from "next/link";
import { ChevronDown, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
        <Button aria-label="Add a question to this topic">
          <Plus className="h-4 w-4" />
          Add question
          <ChevronDown className="h-4 w-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onSelect={onWriteItMyself}>
          Write it myself
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={UPLOAD_PATH}>Paste LaTeX / upload</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link className="flex-col items-start gap-0.5" href={UPLOAD_PATH}>
            <span>Generate from material</span>
            <span className="text-xs text-muted-foreground">
              Lands in Needs review
            </span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          All three enter the same review queue. Approve, publish, then release.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
