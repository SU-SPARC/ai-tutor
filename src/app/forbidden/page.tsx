import type { Metadata } from "next";
import Link from "next/link";
import { ShieldX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Access denied | Suffolk Probability Tutor",
};

export default function ForbiddenPage() {
  return (
    <main className="mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-lg items-center px-6 py-12">
      <Card className="w-full">
        <CardHeader className="space-y-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ShieldX className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-3xl font-semibold">Access denied</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              This signed-in account does not have access to instructor tools.
              If access was recently granted, sign out and sign in again. For
              help, contact the application administrator.
            </p>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/dashboard">Return to your dashboard</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/account">View account</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
