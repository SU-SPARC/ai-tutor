# Courses, sections, and per-section release

See also `docs/ui-redesign-demo.md` for the shell, the Sheet, and the student screens built on top of this.

> **Wording update (2026-09-29).** The screens below were relabeled for professors who are
> not comfortable with technology; see `docs/professor-vocabulary.md`. In the UI: "Topic
> builder" is **Choose questions**; "Clone" is **Copy for a new term**; "Release" / "Released"
> are **Show to Section 1** / **Shown to Section 1**; "Published" is **Ready to use**; "Held" is
> **Paused: this version was withdrawn**; "Sec 01" is **Section 1** and "Wk 3" is **Week 3**;
> the week Open/Closed control reads **Students can see this week: Yes / No / From a date**;
> add and remove are text buttons; the join code has its own panel with **Copy code** and
> **Show full screen**; changes waiting for "Review changes" are guarded on leaving the page;
> the demo reset lives once at the bottom of `/professor/courses` (demo mode only). Internal
> state names are unchanged, so the rest of this document still describes the model accurately.

This is the professor side of the "Courses, Sections, and Professor-Authored
Topic Questions" blueprint. It is **no longer a browser-only demo**: courses,
course topics, sections, rosters, topic availability and per-section question
releases are stored server side (migration `029_courses_sections.sql`, see
`docs/database.md`) and every professor sees only the courses they own. The
immutable question lifecycle is untouched; a course only _overlays_ the
canonical topic list and a section only _pins_ an already-published version.

## How state flows

- `GET /api/professor/courses` (`requireProfessor`) returns
  `{ state: CoursesState, demo: boolean }`: the signed-in professor's courses in the same
  shape the screens always used, with students as hashed keys only.
- `POST /api/professor/courses/actions` (`requireProfessor`) takes `{ action }`, one
  `CoursesAction`. The route rebuilds the action field by field from a per-type whitelist
  (`src/app/api/professor/courses/actions/parse-action.ts`: trimmed ids, bounded text, no
  nested objects passed through, `hydrate` refused, `now` stamped by the server), then the
  repository runs the same pure `coursesReducer` on the persisted course inside one
  transaction and returns the fresh state. Errors: 400 invalid / rejected action, 404 unknown
  course or one the professor does not own, 409 concurrent change, 503 data service
  unavailable. `Idempotency-Key` (or `X-Request-Id`) becomes the event's request id.
- The client store (`src/components/courses/courses-store.tsx`, logic in
  `courses-sync.ts`) loads on mount (`hydrated` stays `false` until then, so screens show
  skeletons instead of "not found"), applies each dispatched action optimistically with the
  pure reducer, and saves actions one at a time in order. The server's answer replaces the
  local state; a 4xx shows the server's reason in a toast, a 503 or network failure shows
  "Could not save, try again", and either way the queue is dropped and the state reloaded.
- `course/setActive` (the header switcher) never leaves the browser: it is remembered in
  `localStorage` under `ai-tutor-courses-active-course`. Nothing else is kept in the browser;
  the old whole-state key `ai-tutor-courses-demo-v1` is removed on load.
- Demo-only actions: `reset` and `bank/publish` / `bank/addDraft` are only accepted by the
  in-memory demo store. Outside demo mode the Reset button is not rendered, the topic page's
  "Write it myself" item is hidden, and "Make ready to use" links to the question's own page
  (publishing goes through the reviewed lifecycle there).

## Running it locally (demo store)

```
APP_ENV=development
APP_DEMO_MODE=true
APP_URL=http://localhost:3000
GHOST_LOGIN_ENABLED=true
```

Put that in `.env.local` and run `npm run dev`. Open `/join` and choose
**Professor demo sign-in** (under the sheet, also linked from the landing page as
"I’m a professor"). No Clerk keys and no `DATABASE_URL` are needed: demo modes use an
in-process demo repository seeded from `src/lib/courses/demo-seed.ts` per professor, so
changes last until the dev server restarts (or "Reset demo" is pressed). With a database the
same screens read and write Postgres.

### Ghost login

`GHOST_LOGIN_ENABLED` makes `/join` the way in (`/sign-in` and `/sign-up` redirect
there): "Continue as guest" and "Professor demo sign-in" each set an `httpOnly` cookie
(`ai-tutor-ghost-session=student|professor`). The principal
resolver returns a synthetic account for that role and never touches the
database. The flag is refused by environment validation in `preview`,
`staging`, and `production`, and whenever Clerk keys are configured, so it
cannot leak into a real deployment. See `src/lib/auth/ghost-session.ts`,
`src/app/sign-in/ghost-actions.ts`, and `tests/ghost-session.test.ts`.

## Where things live

| Path                                         | Role                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/courses/types.ts`                   | Domain contract: `Course`, `CourseTopic` (overlay), `CourseSection`, `SectionMember` (hashed keys only), `SectionTopicAvailability`, `SectionQuestionAvailability` (pins `releasedVersion` + delivery settings), `BankQuestion`, `CoursesState`. Mirrors the tables proposed in the blueprint.                                                                         |
| `src/lib/courses/reducer.ts`                 | Pure `coursesReducer`, run by both the client (optimistically) and the server (authoritatively) — create/clone/archive courses, add sections, reorder/label/exclude topics, open/close/schedule topics, apply staged release changes, delivery settings, move a section to a newer version, publish, add a draft. Never throws; invalid or blocked changes are no-ops. |
| `src/lib/courses/selectors.ts`               | Read models for every screen: course summary and pipeline, section builder, release preview (ready / blocked / pinned-session warnings), copy-to-section diff, per-question release map, section progress and mastery.                                                                                                                                                 |
| `src/lib/courses/demo-seed.ts`               | Deterministic seed for the demo repository only: 11 canonical topics, a 120-question bank drawn from `data/demo/*.json` with a mix of draft / needs review / approved / published / unpublished states, two active and two archived MATH-255 offerings, three rosters, released sets per section, pinned sessions.                                                     |
| `src/components/courses/courses-store.tsx`   | `CoursesStoreProvider` (mounted by the root layout around the header for professors, and by `src/app/professor/layout.tsx`), `useCoursesStore`, `useOptionalCoursesStore`, `useActiveCourse`. Loads from `/api/professor/courses`, saves through `/api/professor/courses/actions`, exposes `hydrated`, `demo`, `loadFailed`, `reload`, and `reset` (demo only).        |
| `src/components/courses/courses-sync.ts`     | Pure client-sync reducer: last server state + queue of unsaved actions + the browser's active course → what the screens render. Tested in `tests/courses-store.test.ts`.                                                                                                                                                                                               |
| `src/app/api/professor/courses/**`           | The two professor routes and the action whitelist parser. Tested in `tests/professor-courses-api.test.ts`.                                                                                                                                                                                                                                                             |
| `src/components/courses/course-switcher.tsx` | The `[MATH-255 · Fall 2026 ▾]` control in the app header, beside the wordmark, for professors.                                                                                                                                                                                                                                                                         |

## Screens

| Route                                      | Blueprint | Notes                                                                                                                                                                                                                                                                                      |
| ------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/professor`                               | hub       | "Courses" line under the workspace overview.                                                                                                                                                                                                                                               |
| `/professor/courses`                       | S1        | Card grid, one attention line per course, dashed New / Clone tile, archived list.                                                                                                                                                                                                          |
| `/professor/courses/[id]`                  | S2        | Five-stage release pipeline (draft → needs review → approved → published → released per section), sections list with join codes, drag-order syllabus overlay with rename / exclude.                                                                                                        |
| `/professor/courses/[id]/topics?section=`  | S3 ★      | Left: released set for the chosen section with topic open/closed/scheduled state, reorder, and per-question delivery settings. Right: bank grouped by topic with ⊕ / ⊖ / disabled-⊕ (reason deep-links to review or publish). Changes are staged; nothing writes until "Review N changes". |
| (modal)                                    | S7        | Ready / blocked per item, pinned-session warning on removals, "applies only to Sec 01", one atomic apply.                                                                                                                                                                                  |
| `/professor/courses/[id]/topics/[topicId]` | S4        | Filter chips, "Released to" column, Publish / Review actions, preview drawer, "Add question" menu (demo: write inline → needs review; paste / generate route to the existing upload flow).                                                                                                 |
| `/professor/courses/[id]/sections/[sid]`   | S5        | Progress tiles, topic-mastery bars, hashed-key roster with search / sort / export, Availability tab → S3 pre-scoped, Settings with join-code regenerate and archive.                                                                                                                       |
| `/professor/questions/[qid]`               | S6        | "Where this is released" rail: live / older version (with **Move to vN**) / held / not released, per course and section.                                                                                                                                                                   |

## Known limits

- Reorder uses ▲▼ buttons behind the ⠿ grip; no drag-and-drop dependency was added.
- In the demo store, the legacy question editor page reads the demo lifecycle fixture, which labels every demo question `v1`, while the courses seed gives those questions higher version numbers so the "older version → Move to vN" case can be shown. With a database both read the same versions table.
- `/professor/students` and `/professor/analytics` are not yet filtered by the course switcher; the section page carries the section-scoped view instead.
- Screens still pass the demo clock (`SEED_NOW`) as `now` when they dispatch; the optimistic copy can show it for a moment, but the server stamps its own time and its answer replaces it.
- The demo store lives in server memory: restarting the dev server, or "Reset demo", returns to the seed.
