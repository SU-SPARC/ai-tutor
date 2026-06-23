# Tutoring App Foundation

This project uses a Next.js TypeScript App Router foundation under `src/app`.

The source tree separates concerns as follows:

- `src/components`: reusable UI and tutor-facing components.
- `src/lib/data`: demo data access and future database boundaries.
- `src/lib/tutor`: rule-first tutoring, retrieval, usage limits, and review auth.
- `src/lib/ai`: server-only LLM fallback integration.
- `data/demo`: public demo fixtures only.
- `data/processed`: non-private processed fixtures only.
- `data/eval`: public evaluation fixtures only.

Secrets must stay in environment variables. LLM calls must remain server-side.
Course PDFs, textbook extracts, answer keys, private chunks, embeddings, and
generated private artifacts must stay out of git; see
`docs/course-material-safety.md`.
