"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";

import { ConfirmDialog } from "@/components/courses/confirm-dialog";
import { useCoursesStore } from "@/components/courses/courses-store";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

/**
 * The demo persists every change in this browser. One visible way back to the
 * seeded state keeps a demo recoverable without clearing site data by hand.
 * It is the quiet action in a header, so it never outranks the primary.
 */
export function DemoResetButton() {
  const { reset } = useCoursesStore();
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <Button
        onClick={() => setConfirming(true)}
        type="button"
        variant="ghost"
      >
        <RotateCcw aria-hidden="true" />
        Reset demo data
      </Button>
      <ConfirmDialog
        confirmLabel="Reset demo data"
        description="Every course, section, and release you changed in this browser goes back to the seeded demo."
        onConfirm={() => {
          reset();
          toast({ title: "Demo data reset", tone: "success" });
        }}
        onOpenChange={setConfirming}
        open={confirming}
        title="Reset the courses demo?"
      />
    </>
  );
}
