"use client";

import { useState } from "react";
import { Eye } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { InstructorStudentIdentity } from "@/lib/types";

const UNAVAILABLE: InstructorStudentIdentity = { status: "unavailable" };

/**
 * Name and email are hidden until an instructor asks for them, and the
 * request is made per page visit: nothing about a reveal is stored in the
 * browser, so leaving or reloading the page hides them again. A reveal that
 * did not complete keeps the button, so the instructor can try again.
 *
 * Rendered as a strip under the page header: what is hidden on the left, the
 * one control on the right. The result replaces the text in the same status
 * region, so it is announced.
 */
export function InstructorStudentIdentityPanel({
  studentKey,
  studentLabel,
}: {
  studentKey: string;
  studentLabel: string;
}) {
  const [identity, setIdentity] = useState<InstructorStudentIdentity>();
  const [pending, setPending] = useState(false);

  async function reveal() {
    setPending(true);
    try {
      const response = await fetch(
        `/api/professor/students/${studentKey}/identity`,
        { method: "POST" },
      );
      setIdentity(
        response.ok
          ? ((await response.json()) as InstructorStudentIdentity)
          : UNAVAILABLE,
      );
    } catch {
      setIdentity(UNAVAILABLE);
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="account-identity-heading"
      className="flex flex-col gap-3 rounded-panel bg-sheet p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id="account-identity-heading" className="type-h3 text-ink">
          Name and email
        </h2>
        <div role="status">
          {identity ? (
            <IdentityResult identity={identity} />
          ) : (
            <p className="type-body max-w-prose text-ink">
              Names and emails are hidden to protect student privacy. Showing
              them is recorded in the course log.
            </p>
          )}
        </div>
      </div>
      {identity && identity.status !== "unavailable" ? null : (
        <Button
          aria-label={`Show name and email for ${studentLabel}`}
          className="min-h-11 self-start sm:self-center"
          loading={pending}
          onClick={reveal}
          variant="outline"
        >
          <Eye aria-hidden="true" />
          Show name and email
        </Button>
      )}
    </section>
  );
}

function IdentityResult({ identity }: { identity: InstructorStudentIdentity }) {
  if (identity.status === "identified") {
    return (
      <dl className="mt-1 grid gap-x-8 gap-y-2 sm:grid-cols-3">
        <IdentityField label="Name" value={identity.displayName} />
        <IdentityField
          label="Username"
          missing="Username unavailable"
          mono
          value={identity.username}
        />
        <IdentityField
          label="Email"
          missing="Email unavailable"
          value={identity.email}
        />
      </dl>
    );
  }

  return (
    <p className="type-body max-w-prose text-ink">
      {MESSAGES[identity.status]}
    </p>
  );
}

/**
 * A field the account does not hold is named and marked unavailable rather
 * than dropped, so an instructor can tell an absent value from one that failed
 * to load.
 */
function IdentityField({
  label,
  missing,
  mono = false,
  value,
}: {
  label: string;
  missing?: string;
  mono?: boolean;
  value?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="type-small font-medium text-ink">{label}</dt>
      <dd
        className={
          value
            ? `type-body break-words text-ink${mono ? " font-mono" : ""}`
            : "type-body text-ink-muted"
        }
      >
        {value ?? missing}
      </dd>
    </div>
  );
}

const MESSAGES = {
  anonymous:
    "This student practiced without signing in, so there is no name or email to show.",
  unavailable:
    "That didn’t work and nothing changed. Try again, or reload the page.",
  unlinked: "This student no longer has an account, so there is no name or email to show.",
} as const;
