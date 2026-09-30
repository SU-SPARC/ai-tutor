"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { Download } from "lucide-react";

import type { StudentOnboardingActionState } from "@/app/onboarding/actions";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  clearLegacyAnonymousStudentId,
  readLegacyAnonymousStudentId,
} from "@/lib/auth/anonymous-student";

type Feedback = {
  kind: "error" | "success";
  text: string;
};

const START_FRESH_LABEL = "Start fresh (don't bring it over)";
const START_FRESH_CAPTION =
  "If you start fresh, the practice saved in this browser is removed.";

/**
 * The import routes answer in system words ("signed browser practice
 * identity", "migration window"); the student reads one plain sentence per
 * status instead. The routes themselves are unchanged.
 */
function importErrorText(status: number) {
  switch (status) {
    case 400:
      return "There's no guest practice in this browser.";
    case 409:
      return "This guest practice is already in another account.";
    case 410:
      return "Older practice can no longer be brought over.";
    case 429:
      return "Too many tries. Wait a minute, then try again.";
    default:
      return "Couldn't bring it over. Try again.";
  }
}

/**
 * "Bring over your guest practice?": shown only while this browser holds
 * guest practice (a signed guest cookie, or an older browser-only id). On the
 * onboarding notice the component also holds the one way forward, the
 * acknowledgement form, which stays below the panel whether or not there is
 * practice to bring over.
 */
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
  const captionId = useId();

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

      if (!response.ok) {
        setFeedback({ kind: "error", text: importErrorText(response.status) });
        return;
      }

      if (options.source === "legacy") {
        clearLegacyAnonymousStudentId(legacyId);
        setLegacyId(undefined);
      } else {
        setSignedIdentityAvailable(false);
      }

      // The route counts tutor sessions, not questions, so the sentence does
      // not print a number that would read as "questions".
      setFeedback({
        kind: "success",
        text: "Done: your guest practice is in your account.",
      });
    } catch {
      setFeedback({ kind: "error", text: importErrorText(0) });
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

      if (!response.ok) {
        setFeedback({
          kind: "error",
          text: "Couldn't remove the browser practice. Try again.",
        });
        return;
      }

      setSignedIdentityAvailable(false);
      setFeedback({
        kind: "success",
        text: "Browser practice removed. Your account starts fresh.",
      });
    } catch {
      setFeedback({
        kind: "error",
        text: "Couldn't remove the browser practice. Try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  const feedbackLine = feedback ? (
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
  ) : null;

  // While the older-practice check runs, a row shaped like the buttons holds
  // the place (never a spinner); it goes away once the check finds nothing.
  const checking =
    checkingLegacy && !hasBrowserPractice ? (
      <div
        role="status"
        className="flex flex-col gap-2"
        data-slot="guest-practice-checking"
      >
        <span className="sr-only">Checking for guest practice…</span>
        <Skeleton className="h-10 w-48" />
      </div>
    ) : null;

  // On the onboarding notice, starting fresh is the acknowledgement itself
  // (the action clears the guest cookie); on the account page it is its own
  // button. Older browser-only practice is not removed by either, so the
  // choice is offered only for the signed guest practice.
  const offersStartFresh = signedIdentityAvailable;

  // A quiet tinted panel inside the page's sheet: this is a decision the
  // student makes once, not a warning, so it carries no amber and no border.
  const panel = hasBrowserPractice ? (
    <section
      aria-labelledby="browser-practice-heading"
      aria-busy={busy}
      className="flex flex-col gap-4 rounded-panel bg-surface-tint p-4 sm:p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="browser-practice-heading" className="type-h3 text-ink">
          Bring over your guest practice?
        </h2>
        <p className="type-body max-w-prose text-ink-muted">
          You practiced as a guest in this browser. Bring it into your account
          only if this is your own computer.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        {signedIdentityAvailable ? (
          <Button
            disabled={busy}
            type="button"
            variant="cta"
            onClick={() =>
              requestImport("/api/account/claim-anonymous", {
                source: "signed",
              })
            }
          >
            <Download aria-hidden="true" />
            Bring it over
          </Button>
        ) : null}
        {legacyId ? (
          <Button
            disabled={busy}
            type="button"
            variant={signedIdentityAvailable ? "outline" : "cta"}
            onClick={() =>
              requestImport("/api/identity/legacy-anonymous", {
                body: { legacyAnonymousId: legacyId },
                source: "legacy",
              })
            }
          >
            <Download aria-hidden="true" />
            Bring over older practice
          </Button>
        ) : null}
        {!continueAction && offersStartFresh ? (
          <Button
            disabled={busy}
            type="button"
            variant="ghost"
            aria-describedby={captionId}
            onClick={() => void discardSignedPractice()}
          >
            {START_FRESH_LABEL}
          </Button>
        ) : null}
      </div>
      {!continueAction && offersStartFresh ? (
        <p id={captionId} className="type-caption">
          {START_FRESH_CAPTION}
        </p>
      ) : null}
      {feedbackLine}
    </section>
  ) : null;

  if (!continueAction) {
    if (!panel && !checking && !feedbackLine) {
      return null;
    }
    return (
      <div className="flex flex-col gap-3">
        {checking}
        {panel ?? feedbackLine}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {checking}
      {panel ?? feedbackLine}
      <OnboardingContinueForm
        action={continueAction}
        disabled={busy || checkingLegacy}
        hasBrowserPractice={hasBrowserPractice}
        startsFresh={offersStartFresh}
      />
    </div>
  );
}

function OnboardingContinueForm({
  action,
  disabled,
  hasBrowserPractice,
  startsFresh,
}: {
  action: (
    state: StudentOnboardingActionState,
  ) => Promise<StudentOnboardingActionState>;
  disabled: boolean;
  hasBrowserPractice: boolean;
  startsFresh: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const captionId = useId();

  // Bringing practice over is the one mint action while there is practice to
  // bring; the acknowledgement then steps back to an outline button and says
  // what it does to that practice. Otherwise it is the screen's one mint.
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Button
        disabled={disabled}
        loading={pending}
        type="submit"
        size="lg"
        variant={hasBrowserPractice ? "outline" : "cta"}
        aria-describedby={startsFresh ? captionId : undefined}
        className="h-auto min-h-12 w-full py-2 whitespace-normal sm:w-fit"
      >
        {startsFresh ? START_FRESH_LABEL : "Got it, start practicing"}
      </Button>
      {startsFresh ? (
        <p id={captionId} className="type-caption">
          {START_FRESH_CAPTION}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="type-body font-medium text-red-700">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
