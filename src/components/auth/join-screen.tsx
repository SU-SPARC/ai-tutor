"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId } from "react";
import { useFormStatus } from "react-dom";

import { joinAsDemoProfessor, joinAsGuestStudent } from "@/app/join/actions";
import { SectionCodeForm } from "@/components/auth/section-code-form";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";

export {
  parseSectionCode,
  SECTION_CODE_ERROR,
  SECTION_CODE_UNKNOWN_ERROR,
  sectionCodeProblem,
} from "@/components/auth/section-code-form";

export type JoinScreenProps = {
  /** Passed through raw; the server action normalises it. */
  callbackUrl: string;
  clerkEnabled: boolean;
  ghostLoginEnabled: boolean;
  guestPracticeEnabled: boolean;
  /** Pre-built `/sign-in?callbackUrl=…` for the Clerk door. */
  ssoHref: string;
};

function OrRule() {
  return (
    <div className="type-caption flex items-center gap-3">
      <span aria-hidden="true" className="h-px flex-1 bg-rule" />
      or
      <span aria-hidden="true" className="h-px flex-1 bg-rule" />
    </div>
  );
}

function GuestSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="link" loading={pending} className="min-h-11">
      Continue as guest
    </Button>
  );
}

function ProfessorSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="link" loading={pending} className="min-h-11">
      Professor sign-in
    </Button>
  );
}

/**
 * One sheet: the section code first (the student's own door, and the one
 * mint action), then guest practice as a quiet text button, then the data
 * notice. Suffolk SSO leads only where it is configured; in the demo one
 * caption says it is not available. The professor demo door sits under the
 * sheet ("Teaching MATH-255? Professor sign-in").
 *
 * The section code is `SectionCodeForm`, the same form the landing hero
 * uses: it stores the code and then takes the guest door (demo) or goes to
 * the syllabus. The logo heads the sheet, above the one h1.
 */
export function JoinScreen({
  callbackUrl,
  clerkEnabled,
  ghostLoginEnabled,
  guestPracticeEnabled,
  ssoHref,
}: JoinScreenProps) {
  const router = useRouter();
  const guestNoteId = useId();

  const guestDoor = ghostLoginEnabled ? (
    <form action={joinAsGuestStudent} className="flex justify-center">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <GuestSubmitButton />
    </form>
  ) : guestPracticeEnabled ? (
    <div className="flex justify-center">
      <Button asChild variant="link" className="min-h-11">
        <Link href="/practice">Continue as guest</Link>
      </Button>
    </div>
  ) : (
    <div className="flex flex-col items-center gap-1">
      <Button
        type="button"
        variant="link"
        disabled
        aria-describedby={guestNoteId}
        className="min-h-11"
      >
        Continue as guest
      </Button>
      <p id={guestNoteId} className="type-caption">
        Guest practice is turned off in this environment.
      </p>
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <section
        aria-labelledby="join-title"
        className="sheet-shadow flex flex-col gap-6 rounded-panel bg-sheet p-6 text-sheet-foreground sm:p-8"
      >
        <header className="flex flex-col gap-2">
          <Logo size="lg" wordmark priority className="mb-4" />
          <h1 id="join-title" className="type-h1 text-ink">
            Join MATH-255
          </h1>
          <p className="type-body text-ink-muted">
            {clerkEnabled
              ? "Sign in with your Suffolk account, or enter the section code from your professor."
              : "Enter the section code from your professor, or practice as a guest."}
          </p>
        </header>

        {clerkEnabled ? (
          <>
            <Button asChild size="lg" className="w-full">
              <Link href={ssoHref}>Continue with Suffolk (SSO)</Link>
            </Button>
            <OrRule />
          </>
        ) : null}

        <SectionCodeForm
          ghostLoginEnabled={ghostLoginEnabled}
          callbackUrl={callbackUrl}
          joinVariant={clerkEnabled ? "secondary" : "cta"}
          onNavigate={(href) => router.push(href)}
        />

        {clerkEnabled ? null : <OrRule />}

        {guestDoor}

        {clerkEnabled ? null : (
          <p className="type-caption text-center">
            {"Suffolk sign-in isn't available in this demo."}
          </p>
        )}

        <div className="flex flex-col gap-2 border-t border-rule pt-6">
          <p className="type-small text-ink-muted">
            <span className="font-medium text-ink">What we keep:</span> your
            attempts, hints and answers. Your professor sees you as a code (like
            Student 8F2A); your name is shown only if they open your record, and
            that is logged.
          </p>
          <p className="type-small text-ink-muted">
            {clerkEnabled
              ? "As a guest, your progress lives in this browser. Sign in to keep it."
              : "As a guest, your progress lives in this browser."}
          </p>
        </div>
      </section>

      {ghostLoginEnabled ? (
        <form
          id="professor"
          action={joinAsDemoProfessor}
          className="type-body flex scroll-mt-24 flex-wrap items-center justify-center gap-x-1.5 text-ink-muted"
        >
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <span>Teaching MATH-255?</span>
          <ProfessorSubmitButton />
        </form>
      ) : null}
    </div>
  );
}

/**
 * `/join` for a student who is already signed in (the demo guest included)
 * and did not arrive on a sign-in round trip: the way back to the section
 * code. Only the code form, no guest or SSO doors; a valid code is stored in
 * this browser and the student goes to Learn with a "Joined …" toast.
 */
export function JoinSectionScreen() {
  const router = useRouter();

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
            Enter the section code from your professor.
          </p>
        </header>

        <SectionCodeForm
          ghostLoginEnabled={false}
          joinVariant="cta"
          onNavigate={(href) => router.push(href)}
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
