import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { StatusPage } from "@/components/ui/status-page";

export const metadata: Metadata = {
  title: "Professors only",
};

/**
 * Where a signed-in student lands after opening a professor page. It says
 * whose page this is and sends them back to their own work.
 */
export default function ForbiddenPage() {
  return (
    <StatusPage
      code="Professors only"
      title="This page is for professors"
      description="You're signed in as a student. Your practice is on Learn."
      actions={
        <>
          <Button asChild>
            <Link href="/learn">Back to Learn</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/account">Your account</Link>
          </Button>
        </>
      }
    />
  );
}
