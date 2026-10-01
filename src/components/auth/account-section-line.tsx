"use client";

import Link from "next/link";
import { useState } from "react";

import { useStudentSection } from "@/components/shell/use-student-section";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const LINE_CLASSES = "type-body";
const LINK_CLASSES =
  "rounded-xs font-medium text-azure-500 underline underline-offset-4 hover:text-azure-700 focus-ring";

function formatJoined(iso: string) {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}

/**
 * One line on the account page: the course section this student joined, when
 * they joined it, with "Change section" and "Leave" beside it, or "Have a
 * section code? Enter it" when they are in none. Both links open `/join`,
 * which shows the code form to a signed-in student. Membership is read from
 * the server (`GET /api/student/section`) after hydration, so a placeholder
 * of the same height holds the line until it arrives.
 */
export function AccountSectionLine({ className }: { className?: string }) {
  const { section, hydrated, leave } = useStudentSection();
  const [leaving, setLeaving] = useState(false);

  if (!hydrated) {
    return (
      <p aria-hidden className={cn(LINE_CLASSES, "opacity-0", className)}>
        &nbsp;
      </p>
    );
  }

  if (!section) {
    return (
      <p className={cn(LINE_CLASSES, "text-ink-muted", className)}>
        No section yet. Have a section code?{" "}
        <Link href="/join" className={LINK_CLASSES}>
          Enter it
        </Link>
      </p>
    );
  }

  const joined = formatJoined(section.joinedAt);

  const handleLeave = async () => {
    setLeaving(true);
    const left = await leave();
    setLeaving(false);
    toast(
      left
        ? { title: `Left ${section.label}`, tone: "success" }
        : {
            title: "We couldn't leave your section just now. Try again.",
            tone: "error",
          },
    );
  };

  return (
    <p className={cn(LINE_CLASSES, className)}>
      <span className="font-mono">{section.label}</span>
      {joined ? (
        <span className="text-ink-muted"> · joined {joined}</span>
      ) : null}
      <span className="text-ink-muted" aria-hidden="true">
        {" · "}
      </span>
      <Link href="/join" className={LINK_CLASSES}>
        Change section
      </Link>
      <span className="text-ink-muted" aria-hidden="true">
        {" · "}
      </span>
      <button
        type="button"
        className={cn(LINK_CLASSES, "disabled:opacity-50")}
        disabled={leaving}
        onClick={() => void handleLeave()}
      >
        Leave
      </button>
    </p>
  );
}
