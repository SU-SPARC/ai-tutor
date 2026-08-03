import Link from "next/link";

import { signOut } from "@/auth";
import { resolveAuthenticatedPrincipal } from "@/lib/auth/principal";

export async function AccountActions() {
  let principal: Awaited<ReturnType<typeof resolveAuthenticatedPrincipal>>;
  try {
    principal = await resolveAuthenticatedPrincipal();
  } catch {
    // Header decoration must not make otherwise-public content unavailable
    // when the identity database is temporarily unreachable.
    return <Link href="/sign-in">Sign in</Link>;
  }

  if (!principal) {
    return <Link href="/sign-in">Sign in</Link>;
  }

  return (
    <div className="flex items-center gap-3">
      <Link href="/account">Account</Link>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <button type="submit">Sign out</button>
      </form>
    </div>
  );
}
