import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { StatusPage } from "@/components/ui/status-page";

export const metadata: Metadata = {
  title: "Access denied",
};

export default function ForbiddenPage() {
  return (
    <StatusPage
      code="Access denied"
      title="This account cannot open instructor tools"
      description={
        <>
          <p>
            This signed-in account does not have access to instructor tools.
            If professor access was recently granted in Clerk, reload this
            page after the metadata change is saved.
          </p>
          <p>
            Signing out and back in is not normally required. For help,
            contact the application support team.
          </p>
        </>
      }
      actions={
        <>
          <Button asChild>
            <Link href="/learn">Return to Learn</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/account">View account</Link>
          </Button>
        </>
      }
    />
  );
}
