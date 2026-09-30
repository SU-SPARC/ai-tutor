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
        <Button className="min-h-11" type="button">
          <Plus aria-hidden="true" />
          Add a question
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="type-body">
          You&rsquo;ll approve it before students see it
        </DropdownMenuLabel>
        <DropdownMenuItem className="min-h-11" onSelect={onWriteItMyself}>
          Write it myself
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="min-h-11">
          <Link href={UPLOAD_PATH}>Upload notes or a file</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="min-h-11">
          <Link href={UPLOAD_PATH}>Have the tutor draft questions from my notes</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
