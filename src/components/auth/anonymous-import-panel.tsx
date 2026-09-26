"use client";

import { useActionState, useEffect, useState } from "react";
import { Download, LoaderCircle } from "lucide-react";

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
            ? "Imported 1 saved tutor session into your account."
            : `Imported ${count} saved tutor sessions into your account.`,
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

  // A quiet tinted panel inside the page's sheet: this is a decision the
  // student makes once, not a warning, so it carries no amber and no border.
  return (
    <section
      aria-labelledby="browser-practice-heading"
      aria-busy={busy}
      className="flex flex-col gap-4 rounded-panel bg-surface-tint p-4 sm:p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="browser-practice-heading" className="type-h3 text-ink">
          Practice from this browser
        </h2>
        <p className="type-body max-w-prose text-ink-muted">
          Import only if this is your own browser profile. On a shared computer,
          the saved practice may belong to someone else. Nothing is imported
          until you choose an import button.
        </p>
      </div>

      {checkingLegacy ? (
        <p
          role="status"
          className="type-body flex items-center gap-2 text-ink-muted"
        >
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          Checking this browser for older practice…
        </p>
      ) : null}

      {hasBrowserPractice ? (
        <div className="flex flex-wrap gap-3">
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
              <Download aria-hidden="true" />
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
              <Download aria-hidden="true" />
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
        <p className="type-body text-ink-muted">
          No practice waiting to be imported was found in this browser.
        </p>
      ) : null}

      {feedback ? (
        <p
          role={feedback.kind === "error" ? "alert" : "status"}
          className={
            feedback.kind === "error"
              ? "type-body font-medium text-red-700"
              : "type-body text-ink"
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

  // Importing is the primary choice while there is practice to import; the
  // acknowledgement then steps back to an outline button so the two never
  // compete as equals.
  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 border-t border-rule pt-4"
    >
      <Button
        disabled={disabled}
        loading={pending}
        type="submit"
        variant={hasBrowserPractice ? "outline" : "primary"}
        className="h-auto min-h-10 w-full py-2 whitespace-normal sm:w-fit"
      >
        {hasBrowserPractice
          ? "I understand — continue without importing"
          : "I understand — continue"}
      </Button>
      {state.error ? (
        <p role="alert" className="type-body font-medium text-red-700">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
