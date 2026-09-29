"use client";

import Link from "next/link";
import { useId, useRef, useState, type FormEvent } from "react";

import { joinAsGuestStudent } from "@/app/join/actions";
import {
  isKnownSectionCode,
  SECTION_CODE_UNKNOWN_ERROR,
  sectionLabelForCode,
  useStudentSection,
} from "@/components/shell/use-student-section";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { formatJoinCode } from "@/lib/courses/format";

export { SECTION_CODE_UNKNOWN_ERROR };

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
 * The field's one error line for what was typed, or null when it names a
 * section: a malformed code asks for the shape, a well-formed code that is
 * not a section says so and points at the professor.
 */
export function sectionCodeProblem(raw: string): string | null {
  const parsed = parseSectionCode(raw);
  if (!parsed) {
    return SECTION_CODE_ERROR;
  }
  return isKnownSectionCode(parsed) ? null : SECTION_CODE_UNKNOWN_ERROR;
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
  className?: string;
};

/**
 * The one section-code entry, shared by the landing hero and `/join`: label,
 * a mono field that takes the code in any case with or without the hyphen,
 * and [Join] beside it (below it, full width, on phones).
 *
 * The code is not an account: it labels the section the student is in. A
 * valid code is stored in this browser (`useStudentSection`, the same store
 * the header chip reads), then the student takes the guest door in the demo
 * or goes to the syllabus. A code that is not five letters or digits, or
 * is not one of the course's sections, is refused at the field, on blur and
 * on submit; the typed value stays put. A successful join says so in a toast
 * ("Joined MATH-255 · Section 1") that survives the navigation.
 */
export function SectionCodeForm({
  label = "Section code",
  ghostLoginEnabled,
  callbackUrl = "",
  joinVariant = "cta",
  onNavigate,
  className,
}: SectionCodeFormProps) {
  const { setSection } = useStudentSection();
  const codeId = useId();
  const codeInputRef = useRef<HTMLInputElement>(null);
  const guestFormRef = useRef<HTMLFormElement>(null);
  const learnLinkRef = useRef<HTMLAnchorElement>(null);
  const [code, setCode] = useState("");
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

  const handleJoin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parseSectionCode(code);
    const problem = sectionCodeProblem(code);
    if (!parsed || problem) {
      setCodeError(problem ?? SECTION_CODE_ERROR);
      codeInputRef.current?.focus();
      return;
    }
    setCodeError(null);
    setCode(parsed);
    setSection(parsed);
    setJoining(true);
    // The toast store lives outside React, so the confirmation is still on
    // screen after the guest door or the router takes the student to /learn.
    toast({ title: `Joined ${sectionLabelForCode(parsed)}`, tone: "success" });
    if (ghostLoginEnabled) {
      guestFormRef.current?.requestSubmit();
      return;
    }
    if (onNavigate) {
      onNavigate("/learn");
    } else {
      learnLinkRef.current?.click();
    }
  };

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
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
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
