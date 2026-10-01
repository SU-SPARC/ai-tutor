"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { joinAsGuestStudent } from "@/app/join/actions";
import {
  SECTION_CODE_UNKNOWN_ERROR,
  useStudentSection,
} from "@/components/shell/use-student-section";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { formatJoinCode } from "@/lib/courses/format";

export { SECTION_CODE_UNKNOWN_ERROR };

/**
 * Where a code goes once the student has an identity to join with: `/join`
 * with the code, which joins it on arrival (`autoJoin`). The guest door and
 * the sign-in round trip both come back here.
 */
export function sectionJoinReturnPath(code: string) {
  return `/join?section=${encodeURIComponent(code)}`;
}

export const SECTION_CODE_ERROR =
  "Enter the code from your professor, like K7Q-2M.";

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

/**
 * The field's one error line for the shape of what was typed, or null when
 * it is five letters or digits. Whether a well-formed code names a section
 * is the server's answer (`SECTION_CODE_UNKNOWN_ERROR` when it does not).
 */
export function sectionCodeProblem(raw: string): string | null {
  return parseSectionCode(raw) ? null : SECTION_CODE_ERROR;
}

export type SectionCodeFormProps = {
  /** Visible label. `/join` says "Section code"; the landing hero says whose. */
  label?: string;
  /**
   * Demo environments: a valid code is stored, then the ghost student door
   * (`joinAsGuestStudent`) is taken with `callbackUrl`. Otherwise the student
   * goes straight to the syllabus.
   */
  ghostLoginEnabled: boolean;
  /** Passed through raw; the server action normalises it. */
  callbackUrl?: string;
  /**
   * `cta` (mint) when [Join] is the screen's one call to action; `secondary`
   * where SSO leads instead.
   */
  joinVariant?: "cta" | "secondary";
  /**
   * Navigation for the non-demo path (the join screen passes `router.push`).
   * Without it a hidden `<Link href="/learn">` is followed, so the landing
   * page gets client navigation without taking the router as a dependency.
   */
  onNavigate?: (href: string) => void;
  /** Prefills the field (a code carried through sign-in on `/join`). */
  initialCode?: string;
  /** Joins `initialCode` as soon as the form mounts. */
  autoJoin?: boolean;
  className?: string;
};

/**
 * The one section-code entry, shared by the landing hero and `/join`: label,
 * a mono field that takes the code in any case with or without the hyphen,
 * and [Join] beside it (below it, full width, on phones).
 *
 * The code is not an account: it joins the student to a course section on
 * the server (`POST /api/student/section`, through `useStudentSection`, the
 * same store the header chip reads), and the student goes to the syllabus.
 * A visitor with no identity yet takes the guest door in the demo (or signs
 * in) and comes back to `/join?section=CODE`, which joins on arrival. A code
 * that is not five letters or digits is refused at the field, on blur and on
 * submit; a code that names no section is refused when the server says so.
 * The typed value stays put. A successful join says so in a toast ("Joined
 * MATH-255 · Section 1") that survives the navigation.
 */
export function SectionCodeForm({
  label = "Section code",
  ghostLoginEnabled,
  callbackUrl = "",
  joinVariant = "cta",
  onNavigate,
  initialCode,
  autoJoin = false,
  className,
}: SectionCodeFormProps) {
  const { join } = useStudentSection();
  const codeId = useId();
  const codeInputRef = useRef<HTMLInputElement>(null);
  const guestFormRef = useRef<HTMLFormElement>(null);
  const guestCallbackRef = useRef<HTMLInputElement>(null);
  const learnLinkRef = useRef<HTMLAnchorElement>(null);
  const [code, setCode] = useState(() =>
    initialCode ? (parseSectionCode(initialCode) ?? initialCode) : "",
  );
  const [codeError, setCodeError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const handleCodeChange = (raw: string) => {
    const next = raw.toUpperCase();
    setCode(next);
    // Once the error is showing, it clears as soon as the code is right.
    if (codeError && sectionCodeProblem(next) === null) {
      setCodeError(null);
    }
  };

  const handleCodeBlur = () => {
    // Leaving the field empty is not a mistake until the student asks to join.
    if (code.trim().length === 0) {
      setCodeError(null);
      return;
    }
    setCodeError(sectionCodeProblem(code));
  };

  const navigate = (href: string) => {
    if (onNavigate) {
      onNavigate(href);
    } else if (href === "/learn") {
      learnLinkRef.current?.click();
    } else {
      window.location.assign(href);
    }
  };

  const submitCode = async (typed: string) => {
    const parsed = parseSectionCode(typed);
    if (!parsed) {
      setCodeError(SECTION_CODE_ERROR);
      codeInputRef.current?.focus();
      return;
    }
    setCodeError(null);
    setCode(parsed);
    setJoining(true);

    if (ghostLoginEnabled) {
      // No identity yet in the demo: take the guest door and come back to
      // `/join?section=…`, which joins as the guest student on arrival.
      if (guestCallbackRef.current) {
        guestCallbackRef.current.value = sectionJoinReturnPath(parsed);
      }
      guestFormRef.current?.requestSubmit();
      return;
    }

    const result = await join(parsed);
    if (result.ok) {
      // The toast store lives outside React, so the confirmation is still
      // on screen after the router takes the student to /learn.
      toast({ title: `Joined ${result.section.label}`, tone: "success" });
      navigate("/learn");
      return;
    }

    setJoining(false);
    if (result.reason === "signed_out") {
      // Sign in, then come back to join with the same code.
      navigate(
        `/sign-in?callbackUrl=${encodeURIComponent(
          sectionJoinReturnPath(parsed),
        )}`,
      );
      return;
    }
    setCodeError(result.message);
    codeInputRef.current?.focus();
  };

  const handleJoin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (joining) {
      return;
    }
    void submitCode(code);
  };

  // A code carried through the guest door or sign-in joins on arrival. A
  // timeout (not a synchronous call) keeps the state updates out of the
  // effect body.
  useEffect(() => {
    if (!autoJoin || !initialCode) {
      return;
    }
    const timer = window.setTimeout(() => {
      void submitCode(initialCode);
    }, 0);
    // Strict mode's rehearsal unmount cancels the first timer.
    return () => window.clearTimeout(timer);
    // Runs once per mount: the code to join is fixed by the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={className}>
      <form noValidate onSubmit={handleJoin}>
        <Field
          id={codeId}
          label={label}
          error={codeError}
          className="max-sm:[&_[data-slot=field-row]]:flex-col max-sm:[&_[data-slot=field-row]]:items-stretch"
          trailing={
            <Button
              type="submit"
              variant={joinVariant}
              size="lg"
              loading={joining}
              className="h-11 w-full sm:w-auto"
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
            autoCorrect="off"
            inputMode="text"
            placeholder="K7Q-2M"
            value={code}
            onChange={(event) => handleCodeChange(event.target.value)}
            onBlur={handleCodeBlur}
            className="h-11 tracking-widest pointer-coarse:h-11"
          />
        </Field>
      </form>
      {ghostLoginEnabled ? (
        // The guest door the code takes in the demo: the same server action
        // as "Continue as guest", submitted once the code is stored.
        <form
          ref={guestFormRef}
          action={joinAsGuestStudent}
          hidden
          aria-hidden="true"
        >
          <input
            ref={guestCallbackRef}
            type="hidden"
            name="callbackUrl"
            defaultValue={callbackUrl}
          />
        </form>
      ) : (
        <Link
          ref={learnLinkRef}
          href="/learn"
          prefetch={false}
          hidden
          tabIndex={-1}
          aria-hidden="true"
        >
          Syllabus
        </Link>
      )}
    </div>
  );
}
