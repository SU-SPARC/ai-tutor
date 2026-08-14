"use client";

import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  void error;

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <Card className="border-destructive/60">
        <CardHeader>
          <h1 className="text-2xl font-semibold">
            Your progress could not be loaded
          </h1>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-6 text-muted-foreground">
            Your saved practice is temporarily unavailable. No progress has been
            changed. Try loading it again.
          </p>
          <Button className="mt-5" type="button" onClick={reset}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
