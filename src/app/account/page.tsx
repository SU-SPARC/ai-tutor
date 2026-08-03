import { redirect } from "next/navigation";

import { resolveAuthenticatedPrincipal } from "@/lib/auth/principal";
import { readAnonymousCookieSubject } from "@/lib/auth/anonymous-session";
import { getServerEnv } from "@/lib/env/server";
import { AnonymousImportPanel } from "@/components/auth/anonymous-import-panel";

export default async function AccountPage() {
  const principal = await resolveAuthenticatedPrincipal();
  if (!principal) {
    redirect("/sign-in");
  }
  const env = getServerEnv();
  const anonymousId = await readAnonymousCookieSubject();

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-semibold">Account</h1>
      <dl className="mt-8 grid gap-4 text-sm">
        <div>
          <dt className="font-medium">Name</dt>
          <dd>{principal.displayName}</dd>
        </div>
        <div>
          <dt className="font-medium">Institutional email</dt>
          <dd>{principal.email}</dd>
        </div>
        <div>
          <dt className="font-medium">Application roles</dt>
          <dd>{principal.roles.join(", ") || "none"}</dd>
        </div>
      </dl>
      <p className="mt-8 text-sm text-slate-600">
        Password and MFA recovery are handled by the institutional identity
        provider. Contact application support for role or account-status issues.
      </p>
      <AnonymousImportPanel
        hasSignedBrowserIdentity={Boolean(anonymousId)}
        legacyBridgeEnabled={env.LEGACY_ANONYMOUS_MIGRATION_ENABLED}
      />
    </main>
  );
}
