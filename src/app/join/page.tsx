import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { JoinScreen, JoinSectionScreen } from "@/components/auth/join-screen";
import { SectionCodeForm } from "@/components/auth/section-code-form";
import { Button } from "@/components/ui/button";
import { MAIN_CONTENT_ID } from "@/components/shell/skip-link";
import {
  currentAuthenticatedUser,
  hasPermission,
} from "@/lib/auth/authorization";
import { safeReturnPath } from "@/lib/auth/return-path";
import { getServerEnv } from "@/lib/env/server";
import { parseJoinCode } from "@/lib/tutor/section-content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Join",
};

type JoinPageProps = {
  searchParams: Promise<{ callbackUrl?: string; section?: string | string[] }>;
};

/**
 * `/join` replaces sign-in, sign-up, and `/onboarding` for the pilot: three
 * doors and the data notice on one screen.
 *
 * A signed-in student who opens `/join` on purpose (no `callbackUrl`: the
 * account page's "Change section", the guest line's "Enter it") gets "Join
 * your section", the code form alone. A sign-in round trip (a `callbackUrl`)
 * still goes straight on to the page it asked for, and a professor goes to
 * Learn as before.
 *
 * A section code typed before the student had an identity comes back here as
 * `/join?section=K7Q-2M` (from the guest door or the sign-in round trip): a
 * signed-in student then sees the code form filled in, and it joins the
 * section on arrival.
 *
 * Identity storage being unreachable must not close the page — the guest door
 * does not need it — so the principal lookup degrades to "signed out" rather
 * than throwing, exactly as the landing page does.
 */
export default async function JoinPage({ searchParams }: JoinPageProps) {
  const { callbackUrl, section } = await searchParams;
  const env = getServerEnv();
  const carriedCode = parseJoinCode(
    typeof section === "string" ? section : undefined,
  );

  const principal = await currentAuthenticatedUser().catch(() => undefined);
  if (principal) {
    const cameToChangeSection =
      !callbackUrl && !hasPermission(principal, "professor");
    if (!cameToChangeSection) {
      redirect(safeReturnPath(callbackUrl, "/learn"));
    }
    return (
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="min-h-[calc(100svh-var(--header-h))] bg-surface px-4 py-10 outline-none sm:px-6 sm:py-16"
      >
        {carriedCode ? (
          <CarriedSectionCodeScreen code={carriedCode} />
        ) : (
          <JoinSectionScreen />
        )}
      </main>
    );
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
        sketchpadMeasurementEnabled={
          env.SKETCHPAD_ACTIVE_TIME_MEASUREMENT_ENABLED
        }
        ssoHref={ssoHref}
      />
    </main>
  );
}

/**
 * "Join your section" with the carried code already in the field, joining
 * on arrival; a code that names no section stays in the field with the
 * server's answer under it, and can be corrected.
 */
function CarriedSectionCodeScreen({ code }: { code: string }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <section
        aria-labelledby="join-section-title"
        className="sheet-shadow flex flex-col gap-6 rounded-panel bg-sheet p-6 text-sheet-foreground sm:p-8"
      >
        <header className="flex flex-col gap-2">
          <h1 id="join-section-title" className="type-h1 text-ink">
            Join your section
          </h1>
          <p className="type-body text-ink-muted">
            Joining the section for code{" "}
            <span className="font-mono">{code}</span>.
          </p>
        </header>

        <SectionCodeForm
          ghostLoginEnabled={false}
          joinVariant="cta"
          initialCode={code}
          autoJoin
        />

        <div className="border-t border-rule pt-4">
          <Button asChild variant="link" className="min-h-11">
            <Link href="/learn">Back to Learn</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
