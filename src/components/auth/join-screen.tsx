"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";

import { joinAsDemoProfessor, joinAsGuestStudent } from "@/app/join/actions";
import {
  normalizeSectionCode,
  useStudentSection,
} from "@/components/shell/use-student-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type JoinScreenProps = {
  /** Passed through raw; the server action normalises it. */
  callbackUrl: string;
  clerkEnabled: boolean;
  ghostLoginEnabled: boolean;
  guestPracticeEnabled: boolean;
  /** Pre-built `/sign-in?callbackUrl=…` for the Clerk door. */
  ssoHref: string;
};

/**
 * One screen, three doors, and the data notice that used to be `/onboarding`.
 *
 * The section code is deliberately not a fourth door: it decorates whichever
 * door the student was going to take anyway (it is a label for the section
 * they are in, not a credential), so "Join" stores the code and then submits
 * the guest form rather than going anywhere of its own.
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
  const [code, setCode] = useState("");
  const guestFormRef = useRef<HTMLFormElement>(null);

  const guestDoorAvailable = ghostLoginEnabled || guestPracticeEnabled;

  const enterAsGuest = () => {
    if (ghostLoginEnabled) {
      guestFormRef.current?.requestSubmit();
      return;
    }
    if (guestPracticeEnabled) {
      router.push("/practice");
    }
  };

  const handleJoinWithCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = normalizeSectionCode(code);
    if (!normalized) {
      return;
    }
    setSection(normalized);
    if (ghostLoginEnabled) {
      guestFormRef.current?.requestSubmit();
      return;
    }
    router.push("/learn");
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <div className="flex flex-col gap-6 rounded-lg bg-sheet p-6 text-sheet-foreground sm:p-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <Image
            src="/logo.png"
            alt=""
            width={28}
            height={28}
            className="h-7 w-7"
          />
          <span className="font-display text-[17px] leading-none">
            ProbStat Tutor
          </span>
          <h1 className="font-display text-[28px] leading-tight font-normal">
            Join MATH-255
          </h1>
        </div>

        <div className="flex flex-col gap-3">
          {clerkEnabled ? (
            <Button asChild className="h-11 w-full rounded-[6px]">
              <Link href={ssoHref}>Continue with Suffolk (SSO)</Link>
            </Button>
          ) : (
            <div className="flex flex-col gap-1">
              <Button disabled className="h-11 w-full rounded-[6px]">
                Continue with Suffolk (SSO)
              </Button>
              <p className="text-xs text-muted-foreground">
                SSO is not configured in this demo
              </p>
            </div>
          )}

          {ghostLoginEnabled ? (
            <form ref={guestFormRef} action={joinAsGuestStudent}>
              <input type="hidden" name="callbackUrl" value={callbackUrl} />
              <Button
                type="submit"
                variant="outline"
                className="h-11 w-full rounded-[6px]"
              >
                Continue as guest
              </Button>
            </form>
          ) : guestPracticeEnabled ? (
            <Button
              asChild
              variant="outline"
              className="h-11 w-full rounded-[6px]"
            >
              <Link href="/practice">Continue as guest</Link>
            </Button>
          ) : (
            <div className="flex flex-col gap-1">
              <Button
                disabled
                variant="outline"
                className="h-11 w-full rounded-[6px]"
              >
                Continue as guest
              </Button>
              <p className="text-xs text-muted-foreground">
                Guest practice is turned off in this environment
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
          or enter a section code
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
        </div>

        <form className="flex items-end gap-2" onSubmit={handleJoinWithCode}>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label className="sr-only" htmlFor={codeId}>
              Section code
            </label>
            <Input
              id={codeId}
              autoComplete="off"
              className="h-11 rounded-[6px] font-mono uppercase"
              onChange={(event) => setCode(event.target.value)}
              placeholder="K7Q-2M"
              value={code}
            />
          </div>
          <Button type="submit" className="h-11 rounded-[6px]">
            Join
          </Button>
        </form>

        <div className="flex flex-col gap-3">
          <p className="text-sm leading-6 text-muted-foreground">
            What we keep: your attempts, hints, and progress, tied to a hashed
            key — never your name. Your professor sees “Student 8F2A,” not you.
            Guest progress lives in this browser until you sign in and import
            it.
          </p>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="cta"
              className="h-11 rounded-[6px]"
              disabled={!guestDoorAvailable}
              onClick={enterAsGuest}
            >
              Continue →
            </Button>
          </div>
        </div>
      </div>

      {ghostLoginEnabled ? (
        <form action={joinAsDemoProfessor} className="text-center">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <button
            type="submit"
            className="rounded-md text-xs text-muted-foreground underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Professor demo sign-in
          </button>
        </form>
      ) : null}
    </div>
  );
}
