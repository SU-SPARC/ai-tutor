# Courses, sections, and per-section release — frontend demo

See also `docs/ui-redesign-demo.md` for the shell, the Sheet, and the student screens built on top of this.

This is the working frontend for the "Courses, Sections, and Professor-Authored
Topic Questions" blueprint. It is a **demo**: every course, section, roster,
and release decision lives in the browser, seeded deterministically and
persisted to `localStorage`. No migrations, API routes, or database reads were
added. The immutable question lifecycle is untouched; a course only _overlays_
the canonical topic list and a section only _pins_ an already-published version.

## Running it

```
APP_ENV=development
APP_DEMO_MODE=true
APP_URL=http://localhost:3000
GHOST_LOGIN_ENABLED=true
```

Put that in `.env.local` and run `npm run dev`. Open `/sign-in` and choose
**Continue as professor**. No Clerk keys and no `DATABASE_URL` are needed.

### Ghost login

`GHOST_LOGIN_ENABLED` turns `/sign-in` into a two-button page that sets an
`httpOnly` cookie (`ai-tutor-ghost-session=professor|student`). The principal
resolver returns a synthetic account for that role and never touches the
database. The flag is refused by environment validation in `preview`,
`staging`, and `production`, and whenever Clerk keys are configured, so it
cannot leak into a real deployment. See `src/lib/auth/ghost-session.ts`,
`src/app/sign-in/ghost-actions.ts`, and `tests/ghost-session.test.ts`.

## Where things live

| Path                                         | Role                                                                                                                                                                                                                                                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/courses/types.ts`                   | Domain contract: `Course`, `CourseTopic` (overlay), `CourseSection`, `SectionMember` (hashed keys only), `SectionTopicAvailability`, `SectionQuestionAvailability` (pins `releasedVersion` + delivery settings), `BankQuestion`, `CoursesState`. Mirrors the tables proposed in the blueprint. |
| `src/lib/courses/reducer.ts`                 | Pure `coursesReducer` — create/clone/archive courses, add sections, reorder/label/exclude topics, open/close/schedule topics, apply staged release changes, delivery settings, move a section to a newer version, publish, add a draft. Never throws; invalid or blocked changes are no-ops.   |
| `src/lib/courses/selectors.ts`               | Read models for every screen: course summary and pipeline, section builder, release preview (ready / blocked / pinned-session warnings), copy-to-section diff, per-question release map, section progress and mastery.                                                                         |
| `src/lib/courses/demo-seed.ts`               | Deterministic seed: 11 canonical topics, a 120-question bank drawn from `data/demo/*.json` with a mix of draft / needs review / approved / published / unpublished states, two active and two archived MATH-255 offerings, three rosters, released sets per section, pinned sessions.          |
| `src/components/courses/courses-store.tsx`   | `CoursesStoreProvider` (mounted in `src/app/professor/layout.tsx`), `useCoursesStore`, `useOptionalCoursesStore`, `useActiveCourse`. Seed state renders on the server; the persisted state is swapped in after mount. "Reset demo data" re-seeds.                                              |
| `src/components/courses/course-switcher.tsx` | The `[MATH-255 · Fall 2026 ▾]` control in the app header, beside the wordmark, for professors.                                                                                                                                                                                                 |

## Screens

| Route                                      | Blueprint | Notes                                                                                                                                                                                                                                                                                      |
| ------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/professor`                               | hub       | "Courses" card above the existing overview.                                                                                                                                                                                                                                                |
| `/professor/courses`                       | S1        | Card grid, one attention line per course, dashed New / Clone tile, archived list.                                                                                                                                                                                                          |
| `/professor/courses/[id]`                  | S2        | Five-stage release pipeline (draft → needs review → approved → published → released per section), sections list with join codes, drag-order syllabus overlay with rename / exclude.                                                                                                        |
| `/professor/courses/[id]/topics?section=`  | S3 ★      | Left: released set for the chosen section with topic open/closed/scheduled state, reorder, and per-question delivery settings. Right: bank grouped by topic with ⊕ / ⊖ / disabled-⊕ (reason deep-links to review or publish). Changes are staged; nothing writes until "Review N changes". |
| (modal)                                    | S7        | Ready / blocked per item, pinned-session warning on removals, "applies only to Sec 01", one atomic apply.                                                                                                                                                                                  |
| `/professor/courses/[id]/topics/[topicId]` | S4        | Filter chips, "Released to" column, Publish / Review actions, preview drawer, "Add question" menu (write inline → needs review; paste / generate route to the existing upload flow).                                                                                                       |
| `/professor/courses/[id]/sections/[sid]`   | S5        | Progress tiles, topic-mastery bars, hashed-key roster with search / sort / export, Availability tab → S3 pre-scoped, Settings with join-code regenerate and archive.                                                                                                                       |
| `/professor/questions/[qid]`               | S6        | "Where this is released" rail: live / older version (with **Move to vN**) / held / not released, per course and section.                                                                                                                                                                   |

## Known limits of the demo

- Reorder uses ▲▼ buttons behind the ⠿ grip; no drag-and-drop dependency was added.
- The legacy question editor page reads the demo lifecycle fixture, which labels every demo question `v1`; the courses seed gives those questions higher version numbers so the "older version → Move to vN" case can be shown. When a real API lands, both read the same versions table and the labels agree.
- `/professor/students` and `/professor/analytics` are not yet filtered by the course switcher; the section page carries the section-scoped view instead.
- The Availability, Delivery, and Roster data exist only in this browser. Clearing site data or pressing "Reset demo data" returns to the seed.
