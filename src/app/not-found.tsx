import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { StatusPage } from "@/components/ui/status-page";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <StatusPage
      code="404"
      title="There is no page at this address"
      description="The link may be out of date, or the page may have moved. Your practice and progress are where you left them."
      actions={
        <>
          <Button asChild>
            <Link href="/learn">Go to Learn</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Home</Link>
          </Button>
        </>
      }
    />
  );
}
