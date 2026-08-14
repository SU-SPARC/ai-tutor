import { Loader2 } from "lucide-react";

export default function DashboardLoading() {
  return (
    <main className="min-h-svh bg-background" aria-busy="true">
      <section className="mx-auto flex min-h-80 w-full max-w-6xl items-center justify-center px-6 py-8 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        Loading your practice progress
      </section>
    </main>
  );
}
