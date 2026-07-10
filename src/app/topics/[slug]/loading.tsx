export default function TopicDetailLoading() {
  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-12">
        <div className="flex flex-col gap-3">
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          <div className="h-9 w-64 animate-pulse rounded bg-muted" />
          <div className="h-4 w-full max-w-lg animate-pulse rounded bg-muted" />
        </div>
        <div className="flex flex-col gap-4">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="h-40 animate-pulse rounded-lg border bg-card"
            />
          ))}
        </div>
      </section>
    </main>
  )
}
