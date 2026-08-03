import Link from "next/link";

import {
  INSTITUTIONAL_PROVIDER_ID,
  LOCAL_TEST_PROVIDER_ID,
  signIn,
} from "@/auth";
import { getServerEnv } from "@/lib/env/server";

type SignInPageProps = {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const env = getServerEnv();
  const { callbackUrl, error } = await searchParams;
  const redirectTo = safeRedirectPath(callbackUrl);

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-3xl font-semibold">Sign in</h1>
      <p className="mt-3 text-sm text-slate-600">
        Use the institutional identity provider approved for this application.
      </p>

      {error ? (
        <p className="mt-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error === "IdentityConflict"
            ? "This identity conflicts with an existing account. Contact application support; accounts are not linked by email."
            : "Sign-in could not be completed. Try again or contact application support."}
        </p>
      ) : null}

      {env.AUTH_OIDC_ENABLED ? (
        <form
          className="mt-8"
          action={async () => {
            "use server";
            await signIn(INSTITUTIONAL_PROVIDER_ID, { redirectTo });
          }}
        >
          <button className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white">
            Continue with institutional sign-in
          </button>
        </form>
      ) : null}

      {env.AUTH_TEST_MODE ? (
        <form
          className="mt-8 space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4"
          action={async (formData) => {
            "use server";
            formData.set("redirectTo", redirectTo);
            await signIn(LOCAL_TEST_PROVIDER_ID, formData);
          }}
        >
          <p className="text-sm font-medium text-amber-950">
            Local test mode — not an institutional account
          </p>
          <select
            name="identity"
            className="block w-full rounded-md border border-amber-400 bg-white px-3 py-2 text-sm"
            defaultValue="student"
          >
            <option value="student">Student</option>
            <option value="professor">Professor</option>
            <option value="admin">Administrator</option>
            <option value="disabled">Disabled user (must be rejected)</option>
          </select>
          <button className="rounded-md bg-amber-950 px-4 py-2 text-sm font-medium text-white">
            Use test identity
          </button>
        </form>
      ) : null}

      {!env.AUTH_ENABLED ? (
        <div className="mt-8 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          Authentication is not configured in this environment. Anonymous
          student practice may remain available, but staff areas and durable
          account progress are unavailable.
        </div>
      ) : null}

      <Link className="mt-8 inline-block text-sm underline" href="/">
        Return home
      </Link>
    </main>
  );
}

function safeRedirectPath(value: string | undefined) {
  return value?.startsWith("/") && !value.startsWith("//")
    ? value
    : "/dashboard";
}
