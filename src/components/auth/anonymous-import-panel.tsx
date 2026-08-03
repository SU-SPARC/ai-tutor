"use client";

import { useEffect, useState } from "react";

import {
  clearLegacyAnonymousStudentId,
  readLegacyAnonymousStudentId,
} from "@/lib/auth/anonymous-student";

export function AnonymousImportPanel({
  hasSignedBrowserIdentity,
  legacyBridgeEnabled,
}: {
  hasSignedBrowserIdentity: boolean;
  legacyBridgeEnabled: boolean;
}) {
  const [legacyId, setLegacyId] = useState<string>();
  const [signedIdentityAvailable, setSignedIdentityAvailable] = useState(
    hasSignedBrowserIdentity,
  );
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!legacyBridgeEnabled) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setLegacyId(readLegacyAnonymousStudentId());
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [legacyBridgeEnabled]);

  if (!signedIdentityAvailable && !legacyId) {
    return null;
  }

  async function claim(
    path: string,
    body?: object,
    outcome: "discard" | "legacy" | "signed" = "signed",
  ) {
    setBusy(true);
    setMessage(undefined);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = (await response.json()) as {
        error?: string;
        migratedSessionCount?: number;
      };
      if (!response.ok) {
        setMessage(payload.error ?? "Practice import failed.");
        return;
      }
      if (body) {
        clearLegacyAnonymousStudentId(legacyId);
        setLegacyId(undefined);
      }
      if (outcome === "discard") {
        setSignedIdentityAvailable(false);
        setMessage("Browser practice was left separate from this account.");
      } else {
        if (outcome === "signed") {
          setSignedIdentityAvailable(false);
        }
        setMessage(
          `Imported ${payload.migratedSessionCount ?? 0} practice session(s).`,
        );
      }
    } catch {
      setMessage("Practice import could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <h2 className="font-semibold">Practice from this browser</h2>
      <p className="mt-2">
        Import only if this is your own browser profile. On a shared computer,
        the saved practice may belong to someone else.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        {signedIdentityAvailable ? (
          <>
            <button
              disabled={busy}
              type="button"
              className="rounded-md bg-amber-950 px-3 py-2 text-white"
              onClick={() => claim("/api/account/claim-anonymous")}
            >
              Import signed browser practice
            </button>
            <button
              disabled={busy}
              type="button"
              className="rounded-md border border-amber-700 px-3 py-2"
              onClick={() =>
                claim("/api/account/discard-anonymous", undefined, "discard")
              }
            >
              Do not import
            </button>
          </>
        ) : null}
        {legacyId ? (
          <button
            disabled={busy}
            type="button"
            className="rounded-md bg-amber-950 px-3 py-2 text-white"
            onClick={() =>
              claim(
                "/api/identity/legacy-anonymous",
                { legacyAnonymousId: legacyId },
                "legacy",
              )
            }
          >
            Import legacy browser practice
          </button>
        ) : null}
      </div>
      {message ? <p className="mt-3">{message}</p> : null}
    </section>
  );
}
