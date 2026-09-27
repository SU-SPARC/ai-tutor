import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { JoinScreen } from "@/components/auth/join-screen";
import { MAIN_CONTENT_ID } from "@/components/shell/skip-link";
import { currentAuthenticatedUser } from "@/lib/auth/authorization";
import { safeReturnPath } from "@/lib/auth/return-path";
import { getServerEnv } from "@/lib/env/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Join",
};

type JoinPageProps = {
  searchParams: Promise<{ callbackUrl?: string }>;
};

/**
 * `/join` replaces sign-in, sign-up, and `/onboarding` for the pilot: three
 * doors and the data notice on one screen.
 *
 * Identity storage being unreachable must not close the page — the guest door
 * does not need it — so the principal lookup degrades to "signed out" rather
 * than throwing, exactly as the landing page does.
 */
export default async function JoinPage({ searchParams }: JoinPageProps) {
  const { callbackUrl } = await searchParams;
  const env = getServerEnv();

  const principal = await currentAuthenticatedUser().catch(() => undefined);
  if (principal) {
    redirect(safeReturnPath(callbackUrl, "/learn"));
  }

  const ssoHref = `/sign-in?callbackUrl=${encodeURIComponent(
    safeReturnPath(callbackUrl, "/learn"),
  )}`;

  return (
    <main
      id={MAIN_CONTENT_ID}
      tabIndex={-1}
      className="min-h-[calc(100svh-var(--header-h))] bg-surface px-4 py-10 outline-none sm:px-6 sm:py-16"
    >
      <JoinScreen
        callbackUrl={callbackUrl ?? ""}
        clerkEnabled={env.CLERK_ENABLED}
        ghostLoginEnabled={env.GHOST_LOGIN_ENABLED}
        guestPracticeEnabled={env.ANONYMOUS_PILOT_ENABLED}
        ssoHref={ssoHref}
      />
    </main>
  );
}
