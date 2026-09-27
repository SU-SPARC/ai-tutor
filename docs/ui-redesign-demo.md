# UI redesign: the shipped system

Companion to `docs/courses-sections-demo.md`. This describes the interface on the
`redesign/ui-ux` branch: type, tokens, the shell, the Sheet, every route, and what the
components guarantee for accessibility. It is frontend work: no API route, schema or
permission changed. The one data-layer change is the onboarding demo fallback noted
under "Running the demo".

## Running the demo

`.env.local`: `APP_ENV=development`, `APP_DEMO_MODE=true`, `APP_URL=http://localhost:3000`,
`GHOST_LOGIN_ENABLED=true`. Then `npm run dev` and open `/join`:

- **Continue as guest** signs in the ghost student (or opens `/practice` when only guest
  practice is on). A section code (`K7Q-2M`, any case, with or without the hyphen) is
  stored in this browser and takes the same door.
- **Professor demo sign-in** (under the sheet, `/join#professor`) signs in the ghost
  professor. The landing page links there as "I’m a professor" and "Professor sign-in".

`/sign-in` and `/sign-up` redirect to `/join` while ghost login is on. With `curl`, send
`Cookie: ai-tutor-ghost-session=student` or `=professor`. In demo mode tutor sessions and
the onboarding acknowledgement live in server memory, so restarting the dev server
clears guest progress and shows the data notice again.

## Type (`src/app/layout.tsx`, `src/app/globals.css`)

One superfamily through `next/font`: Source Serif 4 (variable, optical size) for titles and
problem text, Source Sans 3 (400/500/600) for the interface, Source Code Pro (400/500)
for codes and numbers. Pages use only these role classes:

| Class | Spec | Use |
|---|---|---|
| `type-display` | serif 600, 48px (56 from 1024) | landing h1 only |
| `type-h1` | serif 500, 32px | page titles (`PageHeader`) |
| `type-h2` | serif 500, 24px | zones and panels |
| `type-h3` | sans 600, 18px | sub-panels, card titles |
| `type-reading` | serif 400, 17/18px, 65ch | problem statements, hints, steps |
| `type-body` / `type-body-strong` | sans 400 / 500, 16px | default text, control labels |
| `type-small` | sans 400, 14px | table cells, helper text (the table floor) |
| `type-label` / `type-caption` | sans 500 / 400, 13px, ink-muted | group labels, timestamps (the global floor) |
| `type-mono` / `type-mono-input` | mono 15px / 18px, tabular | codes, week labels / the answer field |
| `type-metric` | mono 500, 28px, tabular | numbers in `MetricTile` and pipeline strips |

Chips use `chip-text` (13px, 500). `text-1`…`text-8` exist as raw sizes, but
tailwind-merge reads them as colours and drops them next to a `text-<colour>` class, so
primitives use the named utilities instead. Headings run h1 → h2 → h3 in order, one h1
per page; paragraphs sit in `max-w-prose`.

## Tokens

All colours are oklch in `globals.css`, with a light theme and a dark "chalkboard" theme
where surfaces lighten as they come forward. Every text pair is at least 4.5:1 in both
themes; control boundaries (`--input`) are at least 3:1.

- Surfaces: `surface` (the desk) < `surface-tint` (rails, quiet panels) < `sheet` (the
  Sheet, lightest). Ink: `ink`, `ink-muted`; hairlines `rule`; controls `input`.
- Ramps `azure`, `green`, `amber`, `red` at 100 / 300 / 500 / 700: 100 is a wash, 500 is
  ink on a surface, 700 is ink on its own 100 wash. Azure is primary and focus; green is
  correct; red is wrong or retired; amber is hints and nothing else.
- `mint` is a fill with ink text, used only for the one call to action on a screen
  (Check answer, Continue, Join) and for released questions.
- The logo gradient (azure → cyan → teal → mint) appears only as the header hairline,
  progress fills and the icon. No gradient text or washes.
- Radii: `rounded-control` and `rounded-chip` 6px, `rounded-panel` 10px. One shadow:
  `sheet-shadow`, light theme only. Motion: `duration-fast` 150ms, `duration-base` 250ms;
  `prefers-reduced-motion` removes transitions and animations.
- Legacy shadcn names (`background`, `card`, `primary`, `muted` …) remain as aliases.

## Mastery scale

`MasteryChip`, `MasteryPip` and `MasteryBar` (`src/components/ui/mastery-chip.tsx`) show
five named levels, always with the name printed or spoken: 0 Not started (hollow),
1 Attempted (azure-300), 2 Familiar (azure-500), 3 Proficient (cyan), 4 Mastered (mint).
The Learn model derives the level from solved counts (`topicMasteryLevel`); a bar is
always paired with "n of m". Lifecycle and verdict states use `StatusChip`, whose
`STATUS_TONES` table is the one source for those colours.

## The shell (`src/components/shell/`)

- `AppHeader`: 56px at every width with the gradient hairline under it. Desktop shows
  the wordmark, the course or section chip, the nav words (students: Learn, Practice;
  professors: Workspace, Learn), the theme menu and the account menu. Below 1024 it
  keeps the logo, chip and account and moves the rest into `MobileNav`.
- `ThreeColumn`: rail (264px, from 1024) | main | drawer (380px, from 1280). It renders
  the page's only `<main id="main-content">` and names both asides. A right-edge tab
  (`DrawerEdgeTab`) opens the drawer where its column is not on screen.
- Rails: `SyllabusRail` (students: "Wk 3" + title + mastery pip per topic) and
  `ProfessorRail` (workspace sections with live counts for Review queue, Student reports
  and Students, loaded best-effort by `src/app/professor/layout.tsx`).
- `BottomBar` (phone action bar, safe-area padded), `BackBar` (phone back link with a
  jump-to select), `SkipLink` (first focusable element).
- Primitives in `src/components/ui/`: Button, Input, Textarea, NativeSelect, Checkbox,
  Field (label, helper, polite error line, optional `trailing` control), Tabs and
  `LinkTabs`, Dialog (`side`, `width`, `returnFocusTo`), Tooltip, DropdownMenu,
  StatusChip, MasteryChip, Progress, PageHeader (with `notice`), EmptyState, StatusPage,
  MetricTile, Skeleton, Table (`stickyHeader`, `numeric`), Toast (with Undo), Card,
  Badge, Alert.

## The Sheet (`src/components/sheet/question-sheet.tsx`)

The problem as a worksheet: a ruled left margin whose gutter numbers the hints and steps,
a mono header line (week, position, code, answer type, difficulty), the title as a real
heading, the prompt in `type-reading` with KaTeX, a mono answer field that washes green
or red, and a verdict band ("Correct", "Not quite", "Couldn't read that answer") in a
polite status region. Hints are an amber ladder; steps are an azure ladder that says
"Available once every hint is shown." until they open. Options: `answer.showCheck`
(false when the page has its own Check), `answer.preview` (how the entry reads, in
KaTeX), `hints.revealControl` (false when hints are revealed from elsewhere), `compact`
(list rows), `tombstone` (retired question). `QuestionSheetSkeleton` is its loading state.
It renders the landing hero, practice, topic rows, and the professor previews.

## Student routes

| Route | Screen |
|---|---|
| `/` | h1, one sentence, [Join your course], [I’m a professor], "Continue as guest"; then a live Sheet with a real guest session, three plain statements, and the footer. Signed in: [Continue practicing →]. |
| `/join` | One sheet: section code with [Join] beside it, guest door, SSO (disabled in the demo, with the reason), the data notice; the professor door under it. |
| `/learn` | Continue card (a compact Sheet), syllabus rows (Wk, title, mastery chip and bar, "0 of 2"), this week, saved practice, at a glance. Guests get the same page with a join note. |
| `/learn/[topic]` | Header with mastery and "n of m solved", question rows as compact Sheets with an "Up next" rule, dot row, About panel with Extra practice. |
| `/practice`, `/practice/[id]` | Rail, the Sheet, an action strip that holds the one Check answer and the hint and step controls, the tutor drawer (edge tab from 1024 to 1279, bottom sheet on phones), prev/next pips. The address bar follows the question. |
| `/account`, `/onboarding` | One sheet each; onboarding is the tutor and data notice with the acknowledgement. |
| `/dashboard`, `/topics` | Redirect to `/learn` (`/dashboard` sends a signed-out visitor to sign in first). |

Loading states are skeletons shaped like the page (no spinners); error and not-found
pages use `StatusPage` and name the next step. Titles are short names; the root layout adds
" · ProbStat Tutor".

## Professor routes (inside the workspace rail)

| Route | Screen |
|---|---|
| `/professor` | Question pipeline strip (Drafts → Released, one action per stage), waiting on review, recent decisions, tools, then Courses. |
| `/professor/review` | Topic select, four metric tiles, split view: queue list left, the question and "Your decision" right. |
| `/professor/questions` | Bank and Intake tabs (`?tab=`); bank table grouped by topic with checkboxes and a sticky bulk toolbar; intake form left, draft preview right. |
| `/professor/questions/[id]` | Status, student view, similarity, versions and actions; the "Where this is released" rail. |
| `/professor/upload` | One sheet with the file limit in the notice line. |
| `/professor/students`, `/[studentKey]` | Activity and By topic link tabs, audited usernames, numeric tables; the student record with metric tiles and a 30-day chart. |
| `/professor/analytics`, `/feedback`, `/availability`, `/content-transfer` | Class practice tiles and tables; student reports triage; availability per target with lifecycle state; import and export with a dry run. |
| `/professor/courses/**` | Courses demo (see `docs/courses-sections-demo.md`). |

## Accessibility guarantees

- A skip link reaches `<main id="main-content">`; each page has one h1 and ordered headings.
- Focus is visible everywhere (`focus-ring`, 2px azure, offset 2). Dialogs trap focus,
  close on Escape, and return focus to the opener, or to the menu button when opened
  from a menu item.
- Colour is never the only signal: chips carry a label and an icon, bars carry a count,
  verdicts carry a word.
- Live regions: the verdict band, Field error lines, filter results, staged-change
  counts and toasts announce politely.
- Targets are at least 40px, 44px on touch; text is at least 13px (14px in tables) and
  16px in inputs on phones.
- KaTeX renders HTML and MathML; common expressions also get a spoken description.
