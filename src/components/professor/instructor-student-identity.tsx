"use client";

import { useState } from "react";
import { Eye, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { InstructorStudentIdentity } from "@/lib/types";

const UNAVAILABLE: InstructorStudentIdentity = { status: "unavailable" };

/**
 * Identity is hidden until an instructor asks for it, and the request is made
 * per page visit: nothing about a reveal is stored in the browser, so leaving
 * or reloading the page returns the record to its pseudonymous state.
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Account identity</CardTitle>
        <CardDescription>
          Identity is shown only to authorized instructors. Names, usernames,
          and email addresses are not stored in practice analytics.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {identity ? (
          <IdentityResult identity={identity} />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">Identity hidden</p>
              <p className="text-sm text-muted-foreground">
                Practice analytics for {studentLabel} stay pseudonymous.
              </p>
            </div>
            <Button disabled={pending} onClick={reveal} variant="outline">
              {pending ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              ) : (
                <Eye aria-hidden="true" className="h-4 w-4" />
              )}
              Reveal identity
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function IdentityResult({ identity }: { identity: InstructorStudentIdentity }) {
  if (identity.status === "identified") {
    return (
      <dl aria-live="polite" className="grid gap-3 sm:grid-cols-3">
        <IdentityField label="Name" value={identity.displayName} />
        <IdentityField
          label="Username"
          missing="Username unavailable"
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
    <p aria-live="polite" className="text-sm text-muted-foreground">
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
  value,
}: {
  label: string;
  missing?: string;
  value?: string;
}) {
  return (
    <div className="space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          value
            ? "text-sm font-medium break-words"
            : "text-sm text-muted-foreground"
        }
      >
        {value ?? missing}
      </dd>
    </div>
  );
}

const MESSAGES = {
  anonymous:
    "This student practised without signing in, so there is no account to identify.",
  unavailable: "Identity is temporarily unavailable. Please try again.",
  unlinked: "This student no longer has an account with the course tutor.",
} as const;
