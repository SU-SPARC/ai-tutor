# Local Setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local`.
3. Fill only the values you need for local work:
   - `DATABASE_URL` is optional until durable storage is added.
   - `OPENAI_API_KEY` and `OPENAI_MODEL` enable server-side LLM fallback.
   - `ADMIN_SECRET` enables professor/admin review mutations.
   - `APP_DEMO_MODE`, `MAX_LLM_CALLS_PER_SESSION`, and
     `MAX_DAILY_LLM_CALLS` control demo behavior and usage limits.
4. Run `npm run dev`.

Do not commit `.env.local` or any other local secret file. Do not use
`NEXT_PUBLIC_` for secrets because those values are exposed to browser code.

Course PDFs and professor materials must stay local under
`data/private/course-materials/`. Extracted private text, chunks, embeddings,
and generated private artifacts must stay under ignored private paths.
