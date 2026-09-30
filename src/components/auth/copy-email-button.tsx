"use client";

import { Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

const CONFIRMATION_MS = 2_000;

/**
 * Copies an address for students on machines with no mail client. When the
 * clipboard API is missing or refused, it selects the visible address text
 * (the element with `selectTargetId`) so the student can copy it by hand.
 */
export function CopyEmailButton({
  email,
  selectTargetId,
}: {
  email: string;
  selectTargetId: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(email);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), CONFIRMATION_MS);
    } catch {
      selectAddressText(selectTargetId);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11"
        onClick={copy}
      >
        <Copy aria-hidden="true" />
        Copy email
      </Button>
      <span role="status" className="type-small text-ink-muted">
        {copied ? "Copied" : ""}
      </span>
    </span>
  );
}

function selectAddressText(targetId: string) {
  const target = document.getElementById(targetId);
  const selection = window.getSelection();

  if (!target || !selection) {
    return;
  }

  const range = document.createRange();
  range.selectNodeContents(target);
  selection.removeAllRanges();
  selection.addRange(range);
}
