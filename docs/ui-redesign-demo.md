# Full UI/UX redesign — frontend demo

Companion to `docs/courses-sections-demo.md`. This implements the "ai-tutor — Full UI/UX
Redesign Blueprint": the shared shell, the Sheet, and every student-facing screen. It is
frontend only. The tutor APIs (`/api/tutor/session`, `/api/tutor/respond`) are the only
data writes; in demo mode sessions live in server memory and `getStudentProgress` reads
them, so Learn and Practice show real progress without a database.

## Running it

Same `.env.local` as the courses demo (`APP_ENV=development`, `APP_DEMO_MODE=true`,
`GHOST_LOGIN_ENABLED=true`), then `npm run dev`. `/join` is the one way in: guest
(ghost student), a section code, or the professor demo link at the bottom. `/sign-in`
and `/sign-up` redirect there when ghost login is on; the Clerk paths are unchanged.

## Design system (`src/app/globals.css`, `src/app/layout.tsx`)

- Existing tokens keep their names. Added: `surface-tint`, `sheet`, and the ramps
  `indigo-100/300/500/700`, `green-100/300/500/700`, `amber-100/500`, in light and dark
  (dark flips lightness only; the Sheet is the lightest surface in both).
- Fonts: Newsreader (`font-display`, h1/h2 at weight 400), JetBrains Mono (`font-mono`:
  question codes, join codes, week labels, the answer input), Inter body. Radius 8,
  controls 6. Theme default follows the OS. `prefers-reduced-motion` disables transitions.
- Amber means hints only; red means wrong or retired only; difficulty is a mono word
  (Intro / Core / Stretch) and never a colour.

## Shell (`src/components/shell/`)

| Piece | Role |
|---|---|
| `AppHeader` | 56px, no border, tint band below. Wordmark, course/section chip (professor: the course switcher; student: `MATH-255 · Sec 01` from the joined code), two nav words, account, theme. |
| `ThreeColumn` | `[rail 264] [main] [drawer 380]`; rail hides under `lg`, drawer under `xl`. |
| `AppRail` / `SyllabusRail` / `ProfessorRail` | One rail component: the syllabus with ✓ ● ○ glyphs for students, the workspace sections for professors. |
| `useStudentSection` | The joined section code, stored in this browser. |

## The Sheet (`src/components/sheet/question-sheet.tsx`)

The signature component: serif prompt with KaTeX, mono answer field that washes green or
red on a verdict, green Check button, amber hint ladder, indigo step ladder, optional
footer and menu, `compact` variant for lists, and a skeleton. It renders the landing hero,
the practice page, every question row on a topic page, the professor's preview drawer,
the review panel, and the question editor's "Student view".

## Routes

| Route | Screen | Notes |
|---|---|---|
| `/` | L1 landing | A live Sheet (first question of the third topic) with a real guest session: check answers and reveal hints without signing in. Headline below the product. |
| `/join` | A1 | SSO (disabled in the demo), guest, section code, the data notice, professor demo link. |
| `/learn` | H1 | Continue card, this-week dots (counts, not streaks), numbered syllabus with progress bars and "you are here", saved practice and retired items, at-a-glance ring and calendar. Guests see the same page with a join notice. |
| `/learn/[topic]` | H2 | Dot row per question, each question as a compact Sheet, about panel with "Extra practice". |
| `/practice/[id]`, `/practice` | P1 / P1m | Rail (collapsible to 48px), the Sheet, the tutor drawer (collapsible, remembers its state, states what the tutor can see), Prev/Next footer with pips. Phone: back bar with jump-to-question and a bottom-sheet tutor. |
| `/account` | X1 | Tint-layered; section line; "View as student" for professors. |
| `/dashboard`, `/topics`, `/topics/[slug]` | redirects | to `/learn` and `/learn/[topic]`. |
| `/professor/*` | unchanged screens | Section nav moved into the left rail; the course switcher moved into the header. |

## Known limits of the demo

- Only the 8 approved demo questions across 6 topics are practicable on the student side;
  topics without questions read "no questions yet" and are not clickable. Per-section
  "opens Sep 22" dates and section first-try percentages need the courses backend.
- Guest progress follows the anonymous cookie and the server's memory; restarting the dev
  server clears it.
- No drag-and-drop anywhere; reorder and collapse use buttons.
