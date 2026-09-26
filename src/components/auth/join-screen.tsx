"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { useFormStatus } from "react-dom";

import { joinAsDemoProfessor, joinAsGuestStudent } from "@/app/join/actions";
import { useStudentSection } from "@/components/shell/use-student-section";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatJoinCode } from "@/lib/courses/format";

export type JoinScreenProps = {
  /** Passed through raw; the server action normalises it. */
  callbackUrl: string;
  clerkEnabled: boolean;
  ghostLoginEnabled: boolean;
  guestPracticeEnabled: boolean;
  /** Pre-built `/sign-in?callbackUrl=…` for the Clerk door. */
  ssoHref: string;
};

export const SECTION_CODE_ERROR =
  "Enter the 6-character code from your professor";

/**
 * Section codes are printed as `XXX-XX` (six characters with the hyphen).
 * Students type them in any case, with or without the hyphen or a space, so
 * the letters and digits are what is checked: exactly five, then printed
 * back in the canonical shape so "k7q2m" joins the same section as "K7Q-2M".
 */
export function parseSectionCode(raw: string): string | null {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.length === 5 ? formatJoinCode(cleaned) : null;
}

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
      Professor demo sign-in
    </Button>
  );
}

/**
 * One sheet: the section code first (the student's own door, and the one
 * mint action), then guest practice as a quiet text button, then the data
 * notice. Suffolk SSO leads only where it is configured; in the demo it is a
 * disabled button that says why. The professor demo door sits under the sheet.
 *
 * The section code is deliberately not a separate account: it labels the
 * section the student is in, so "Join" stores the code and then takes the
 * guest door (demo) or goes to the syllabus. A code that is not five letters
 * or digits is refused at the field, on blur and on submit, never ignored.
 */
export function JoinScreen({
  callbackUrl,
  clerkEnabled,
  ghostLoginEnabled,
  guestPracticeEnabled,
  ssoHref,
}: JoinScreenProps) {
  const router = useRouter();
  const { setSection } = useStudentSection();
  const codeId = useId();
  const ssoNoteId = useId();
  const guestNoteId = useId();
  const codeInputRef = useRef<HTMLInputElement>(null);
  const guestFormRef = useRef<HTMLFormElement>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const handleCodeChange = (raw: string) => {
    const next = raw.toUpperCase();
    setCode(next);
    // Once the error is showing, it clears as soon as the code is right.
    if (codeError && parseSectionCode(next)) {
      setCodeError(null);
    }
  };

  const handleCodeBlur = () => {
    // Leaving the field empty is not a mistake until the student asks to join.
    if (code.trim().length === 0) {
      setCodeError(null);
      return;
    }
    setCodeError(parseSectionCode(code) ? null : SECTION_CODE_ERROR);
  };

  const handleJoinWithCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parseSectionCode(code);
    if (!parsed) {
      setCodeError(SECTION_CODE_ERROR);
      codeInputRef.current?.focus();
      return;
    }
    setCodeError(null);
    setCode(parsed);
    setSection(parsed);
    setJoining(true);
    if (ghostLoginEnabled) {
      guestFormRef.current?.requestSubmit();
      return;
    }
    router.push("/learn");
  };

  const guestDoor = ghostLoginEnabled ? (
    <form
      ref={guestFormRef}
      action={joinAsGuestStudent}
      className="flex justify-center"
    >
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

        <form noValidate onSubmit={handleJoinWithCode}>
          <Field
            id={codeId}
            label="Section code"
            error={codeError}
            trailing={
              <Button
                type="submit"
                variant={clerkEnabled ? "secondary" : "cta"}
                size="lg"
                loading={joining}
              >
                Join
              </Button>
            }
          >
            <Input
              ref={codeInputRef}
              name="sectionCode"
              mono
              invalid={Boolean(codeError)}
              autoComplete="off"
              autoCapitalize="characters"
              placeholder="K7Q-2M"
              value={code}
              onChange={(event) => handleCodeChange(event.target.value)}
              onBlur={handleCodeBlur}
              className="h-12 tracking-widest pointer-coarse:h-12"
            />
          </Field>
        </form>

        {clerkEnabled ? null : <OrRule />}

        {guestDoor}

        {clerkEnabled ? null : (
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="secondary"
              size="lg"
              disabled
              aria-describedby={ssoNoteId}
              className="w-full"
            >
              Continue with Suffolk (SSO)
            </Button>
            <p id={ssoNoteId} className="type-caption">
              SSO is not configured in this demo.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2 border-t border-rule pt-6">
          <p className="type-small text-ink-muted">
            <span className="font-medium text-ink">What we keep:</span> your
            attempts, hints and progress, tied to a hashed key, never your name.
            Your professor sees “Student 8F2A”, not you.
          </p>
          <p className="type-small text-ink-muted">
            Guest progress lives in this browser until you sign in and import
            it.
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
