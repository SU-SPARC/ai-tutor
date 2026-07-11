export default function TopicsLoading() {
  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12">
        <div className="flex flex-col gap-3">
          <div className="h-9 w-40 animate-pulse rounded bg-muted" />
          <div className="h-4 w-full max-w-lg animate-pulse rounded bg-muted" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <div
              key={index}
              className="h-48 animate-pulse rounded-lg border bg-card"
            />
          ))}
        </div>
      </section>
    </main>
  )
}
