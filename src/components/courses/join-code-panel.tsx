"use client";

import { useState, useSyncExternalStore } from "react";
import { Copy, Maximize2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";

const noopSubscribe = () => () => {};

/**
 * Where students type the code: this site's /join page. Read from the browser
 * after hydration (the server has no reliable public URL for the demo), so the
 * first render prints the path alone and never mismatches.
 */
export function useJoinUrl(): string {
  const origin = useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => "",
  );
  return `${origin}/join`;
}

/** Copy a join code and say what happened, including when copying fails. */
export async function copyJoinCode(code: string, sectionLabel: string) {
  try {
    await navigator.clipboard.writeText(code);
    toast({
      title: `Copied the join code ${code} for ${sectionLabel}.`,
      description: "Paste it into an email or your course page.",
      tone: "success",
    });
  } catch {
    toast({
      title: "That didn't work and nothing changed.",
      description: `Read the code aloud instead: ${code}.`,
      tone: "error",
    });
  }
}

/**
 * The first thing on a section page: the code a professor reads out in
 * class, big enough to read at a glance, with Copy and a full-screen view
 * for projecting it.
 */
export function JoinCodePanel({
  code,
  sectionLabel,
}: {
  code: string;
  /** Already in words: "Section 1". */
  sectionLabel: string;
}) {
  const joinUrl = useJoinUrl();
  const [fullScreen, setFullScreen] = useState(false);

  return (
    <section
      aria-labelledby="join-code-heading"
      className="flex flex-col gap-4 rounded-panel bg-sheet p-5 sm:p-6"
    >
      <div className="flex flex-col gap-1">
        <h2 className="type-h2 text-ink" id="join-code-heading">
          Join code for {sectionLabel}
        </h2>
        <p className="type-body max-w-prose text-ink">
          Read this code to your class. Students type it at{" "}
          <span className="font-mono">{joinUrl}</span>.
        </p>
      </div>
      <p
        aria-label={`Join code: ${code.split("").join(" ")}`}
        className="type-metric w-fit rounded-control bg-surface-tint px-4 py-2 tracking-widest text-ink"
      >
        {code}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          className="min-h-11"
          onClick={() => void copyJoinCode(code, sectionLabel)}
          type="button"
          variant="secondary"
        >
          <Copy aria-hidden="true" />
          Copy code
        </Button>
        <Button
          className="min-h-11"
          onClick={() => setFullScreen(true)}
          type="button"
          variant="secondary"
        >
          <Maximize2 aria-hidden="true" />
          Show full screen
        </Button>
      </div>

      <Dialog onOpenChange={setFullScreen} open={fullScreen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Join code for {sectionLabel}</DialogTitle>
            <DialogDescription>
              Students go to {joinUrl} and type this code.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex items-center justify-center py-10">
            <p
              aria-label={`Join code: ${code.split("").join(" ")}`}
              className="font-mono font-medium tracking-widest text-ink"
              style={{ fontSize: "clamp(3rem, 14vw, 9rem)", lineHeight: 1.1 }}
            >
              {code}
            </p>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button className="min-h-11" type="button">
                Close
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
