"use client";

import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function ProfessorAnalyticsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  void error;

  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-16">
        <Card role="alert">
          <CardHeader>
            <CardTitle>Course analytics could not be loaded</CardTitle>
            <CardDescription>
              Recorded practice information is temporarily unavailable. Try
              loading the page again.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" onClick={reset}>
              <RotateCcw aria-hidden="true" className="h-4 w-4" />
              Try again
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
