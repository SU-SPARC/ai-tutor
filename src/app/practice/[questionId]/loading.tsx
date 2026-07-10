export default function PracticeQuestionLoading() {
  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-12">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-lg border bg-card" />
        <div className="h-40 animate-pulse rounded-lg border bg-card" />
      </section>
    </main>
  )
}
