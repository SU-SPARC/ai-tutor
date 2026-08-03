import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-3xl font-semibold">Access denied</h1>
      <p className="mt-3 text-sm text-slate-600">
        Your account is signed in but does not have the required application
        role.
      </p>
      <Link className="mt-6 inline-block text-sm underline" href="/">
        Return home
      </Link>
    </main>
  );
}
