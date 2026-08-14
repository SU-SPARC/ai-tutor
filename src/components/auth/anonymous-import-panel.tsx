"use client";

import { useActionState, useEffect, useState } from "react";
import { ArrowRight, Download, Loader2 } from "lucide-react";

import type { StudentOnboardingActionState } from "@/app/onboarding/actions";
import { Button } from "@/components/ui/button";
import {
  clearLegacyAnonymousStudentId,
  readLegacyAnonymousStudentId,
} from "@/lib/auth/anonymous-student";

type Feedback = {
  kind: "error" | "success";
  text: string;
};

export function AnonymousImportPanel({
  continueAction,
  hasSignedBrowserIdentity,
  legacyBridgeEnabled,
}: {
  continueAction?: (
    state: StudentOnboardingActionState,
  ) => Promise<StudentOnboardingActionState>;
  hasSignedBrowserIdentity: boolean;
  legacyBridgeEnabled: boolean;
}) {
  const [legacyId, setLegacyId] = useState<string>();
  const [checkingLegacy, setCheckingLegacy] = useState(legacyBridgeEnabled);
  const [signedIdentityAvailable, setSignedIdentityAvailable] = useState(
    hasSignedBrowserIdentity,
  );
  const [feedback, setFeedback] = useState<Feedback>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!legacyBridgeEnabled) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setLegacyId(readLegacyAnonymousStudentId());
      setCheckingLegacy(false);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [legacyBridgeEnabled]);

  const hasBrowserPractice = signedIdentityAvailable || Boolean(legacyId);

  if (!continueAction && !hasBrowserPractice && !checkingLegacy && !feedback) {
    return null;
  }

  async function requestImport(
    path: string,
    options: {
      body?: object;
      source: "legacy" | "signed";
    },
  ) {
    setBusy(true);
    setFeedback(undefined);

    try {
      const response = await fetch(path, {
        method: "POST",
        headers: options.body
          ? { "Content-Type": "application/json" }
          : undefined,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        migratedSessionCount?: number;
      };

      if (!response.ok) {
        setFeedback({
          kind: "error",
          text: payload.error ?? "Practice import could not be completed.",
        });
        return;
      }

      if (options.source === "legacy") {
        clearLegacyAnonymousStudentId(legacyId);
        setLegacyId(undefined);
      } else {
        setSignedIdentityAvailable(false);
      }

      const count = payload.migratedSessionCount ?? 0;
      setFeedback({
        kind: "success",
        text:
          count === 1
            ? "Imported 1 practice session into your account."
            : `Imported ${count} practice sessions into your account.`,
      });
    } catch {
      setFeedback({
        kind: "error",
        text: "Practice import could not be completed. Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function discardSignedPractice() {
    setBusy(true);
    setFeedback(undefined);

    try {
      const response = await fetch("/api/account/discard-anonymous", {
        method: "POST",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        setFeedback({
          kind: "error",
          text:
            payload.error ?? "The browser practice could not be left separate.",
        });
        return;
      }

      setSignedIdentityAvailable(false);
      setFeedback({
        kind: "success",
        text: "Browser practice was left separate from this account.",
      });
    } catch {
      setFeedback({
        kind: "error",
        text: "The browser practice could not be left separate. Try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="browser-practice-heading"
      aria-busy={busy}
      className="rounded-md border border-warning/50 bg-warning/10 p-4 text-sm"
    >
      <h2 id="browser-practice-heading" className="font-semibold">
        Practice from this browser
      </h2>
      <p className="mt-2 leading-6 text-muted-foreground">
        Import only if this is your own browser profile. On a shared computer,
        the saved practice may belong to someone else. Nothing is imported until
        you choose an import button.
      </p>

      {checkingLegacy ? (
        <p
          role="status"
          className="mt-4 flex items-center text-muted-foreground"
        >
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          Checking this browser for older practice
        </p>
      ) : null}

      {hasBrowserPractice ? (
        <div className="mt-4 flex flex-wrap gap-3">
          {signedIdentityAvailable ? (
            <Button
              disabled={busy}
              type="button"
              onClick={() =>
                requestImport("/api/account/claim-anonymous", {
                  source: "signed",
                })
              }
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Import recent practice
            </Button>
          ) : null}
          {legacyId ? (
            <Button
              disabled={busy}
              type="button"
              variant="outline"
              onClick={() =>
                requestImport("/api/identity/legacy-anonymous", {
                  body: { legacyAnonymousId: legacyId },
                  source: "legacy",
                })
              }
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Import older practice
            </Button>
          ) : null}
          {!continueAction && signedIdentityAvailable ? (
            <Button
              disabled={busy}
              type="button"
              variant="ghost"
              onClick={() => void discardSignedPractice()}
            >
              Do not import
            </Button>
          ) : null}
        </div>
      ) : !checkingLegacy ? (
        <p className="mt-4 text-muted-foreground">
          No practice waiting to be imported was found in this browser.
        </p>
      ) : null}

      {feedback ? (
        <p
          role={feedback.kind === "error" ? "alert" : "status"}
          className={
            feedback.kind === "error"
              ? "mt-4 text-destructive"
              : "mt-4 text-foreground"
          }
        >
          {feedback.text}
        </p>
      ) : null}

      {continueAction ? (
        <OnboardingContinueForm
          action={continueAction}
          disabled={busy || checkingLegacy}
          hasBrowserPractice={hasBrowserPractice}
        />
      ) : null}
    </section>
  );
}

function OnboardingContinueForm({
  action,
  disabled,
  hasBrowserPractice,
}: {
  action: (
    state: StudentOnboardingActionState,
  ) => Promise<StudentOnboardingActionState>;
  disabled: boolean;
  hasBrowserPractice: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="mt-6 border-t pt-4">
      <Button
        disabled={disabled || pending}
        type="submit"
        variant={hasBrowserPractice ? "outline" : "default"}
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        )}
        {hasBrowserPractice
          ? "I understand — continue without importing"
          : "I understand — continue"}
      </Button>
      {state.error ? (
        <p role="alert" className="mt-3 text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
