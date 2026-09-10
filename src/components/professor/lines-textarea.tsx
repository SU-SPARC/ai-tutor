"use client";

import { useState, type ComponentProps } from "react";
import { Textarea } from "@/components/ui/textarea";

/** One entry per line: every line is trimmed and blank lines never become entries. */
export function normalizeLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function sameLines(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  );
}

/**
 * Text to show for the current entries. While the raw draft still normalizes to
 * exactly those entries it is kept verbatim, so a trailing newline or padding
 * stays typeable; otherwise the entries themselves are shown.
 */
export function linesDraftText(
  draft: string | undefined,
  values: string[],
): string {
  return draft !== undefined && sameLines(normalizeLines(draft), values)
    ? draft
    : values.join("\n");
}

/** Controlled multiline field that emits normalized entries without eating the trailing newline. */
export function LinesTextarea({
  values,
  onChange,
  ...props
}: Omit<ComponentProps<typeof Textarea>, "value" | "onChange"> & {
  values: string[];
  onChange: (lines: string[]) => void;
}) {
  const [draft, setDraft] = useState<string>();
  return (
    <Textarea
      {...props}
      value={linesDraftText(draft, values)}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(normalizeLines(e.target.value));
      }}
    />
  );
}
