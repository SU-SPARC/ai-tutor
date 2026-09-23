"use client";

import { RotateCcw } from "lucide-react";

import { useCoursesStore } from "@/components/courses/courses-store";
import { Button } from "@/components/ui/button";

/**
 * The demo persists every change in this browser. One visible way back to the
 * seeded state keeps a demo recoverable without clearing site data by hand.
 */
export function DemoResetButton() {
  const { reset } = useCoursesStore();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-muted-foreground"
      onClick={() => {
        if (window.confirm("Reset the courses demo to its seeded state?")) {
          reset();
        }
      }}
    >
      <RotateCcw className="h-4 w-4" />
      Reset demo data
    </Button>
  );
}
