"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";

import { ConfirmDialog } from "@/components/courses/confirm-dialog";
import { useCoursesStore } from "@/components/courses/courses-store";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { toast } from "@/components/ui/toast";

/**
 * Only when the server says it is the in-memory demo store: one way back to
 * the starting demo (it sends the `reset` action). It erases the professor's
 * demo work, so it is destructive, says so on the button, sits at the bottom
 * of the Courses page only, and asks first. Real courses have no reset, so
 * the button is not rendered at all outside the demo.
 */
export function DemoResetButton() {
  const { reset, demo } = useCoursesStore();
  const [confirming, setConfirming] = useState(false);

  if (!demo) {
    return null;
  }

  return (
    <section
      aria-labelledby="demo-reset-heading"
      className="flex flex-col items-start gap-3 rounded-panel border border-rule p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="type-h3 text-ink" id="demo-reset-heading">
          Start the demo over
        </h2>
        <StatusChip label="Demo only" tone="neutral" />
      </div>
      <p className="type-body max-w-prose text-ink-muted">
        This only exists in the demo. Real courses are never reset.
      </p>
      <Button
        className="min-h-11"
        onClick={() => setConfirming(true)}
        type="button"
        variant="destructive"
      >
        <RotateCcw aria-hidden="true" />
        Reset demo (erases your changes)
      </Button>
      <ConfirmDialog
        cancelLabel="Keep my changes"
        confirmLabel="Erase and start over"
        description="Erase every course, section and question choice you made in the demo and start it over?"
        destructive
        onConfirm={() => {
          reset();
          toast({
            title: "The demo is back to how it started.",
            tone: "success",
          });
        }}
        onOpenChange={setConfirming}
        open={confirming}
        title="Reset the demo?"
      />
    </section>
  );
}
