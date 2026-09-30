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
polite status region. Hints are an amber ladder; steps are an azure ladder; when a question has hints the Sheet shows a `Hints ○○○ → Steps` row whose amber
rungs fill as hints open and whose Steps pip reads "Steps unlock after hint 3" then "Steps ready" (the
landing demo keeps the older sentence). Options: `answer.showCheck`
(false when the page has its own Check), `answer.preview` (how the entry reads, in
KaTeX), `hints.revealControl` (false when hints are revealed from elsewhere), `compact`
(list rows), `tombstone` (retired question). `QuestionSheetSkeleton` is its loading state.
It renders the landing hero, practice, topic rows, and the professor previews.

## Student routes

Every student-facing word follows `docs/student-vocabulary.md` ("Week 3", "Up next",
"Start question n", "2 of 6 solved", "Hint 1 of 3", "Steps unlock after hint 3", "Guest · your
progress lives in this browser.", "No longer available", one mint per screen, the verdict band carrying
the next action, and the truthful privacy sentence). Question codes and answer-type words are hidden
from students except in the report-a-problem caption.

| Route | Screen |
|---|---|
| `/` | h1 "Practice MATH-255, one hint at a time", one sentence, then the **section-code form** ("Section code from your professor", mono `K7Q-2M`, mint Join) with "No code? Try a problem now ↓" and a quiet "I'm a professor" link; signed in: one mint "Continue practicing →". Then the live Sheet ("Try one now — no sign-in needed", real guest session, math keypad), a three-step "How it works" row joined by one hairline, two trust statements, and the footer. |
| `/join` | Logo and wordmark above "Join MATH-255"; the shared section-code form (unknown codes are refused at the field); the guest door; in the demo a caption instead of the SSO button; the data notice with the privacy sentence; "Teaching MATH-255? Professor sign-in". Signed-in students with no callback see "Join your section" (the code form only). |
| `/learn` | Guest line when the progress is not owned by a signed-in user; Continue card ("Week 1 · topic · Question 1 of 1", "Start question 1" / "Continue question n", or "You've solved every question…" + "Keep practicing"); syllabus rows "Week n", title, "Up next" chip, mastery chip with a threshold title, "0 of 2 solved"; "This week" as one line; "Recent practice"; "At a glance" last; no duplicate rail on desktop; trackers hidden for a guest with nothing solved. |
| `/learn/[topic]` | "Week 3" eyebrow, title, description, guest line as the notice, mastery + "n of m solved", mint "Start question n" (also in a BottomBar on phones) or "Next topic: Week n · title →" when finished; question rows without codes, "Up next" chip visible at every width; toolbar only above eight questions; About panel with "Extra practice" and its helper line. |
| `/practice`, `/practice/[id]` | Sheet header "Week 3 · topic · Question 1 of 6 · Intro"; the math answer field (MathLive drawn in place, plain-text first paint) with the keypad (inline on desktop behind "Keypad", docked on phones, its Check hidden when the strip is present); the "Reads as … · checked as …" line; the `Hints ○○○ → Steps` row; verdict band with "Show hint n of m" / "Next question"; solved marks from the server; Alt+← / → and 44px Previous/Next; phone top bar "‹ Question 1 of 6 ›"; tutor drawer/sheet (≤45svh) gated with "Check an answer first…"; "Next topic" at the end; draft answers survive reload; Start over asks first. |
| `/account`, `/onboarding` | Account: "Who you are, your section, and your saved practice.", "You: Guest (demo)" for the demo guest, "What your professor sees", "Change section", Back to Learn and Sign out. Onboarding: "Before you start", one paragraph, "Got it, start practicing", "Read the full notice", the import panel only when there is guest practice. |
| `/dashboard`, `/topics` | Redirect to `/learn`. |

## Professor routes (inside the workspace rail)

Every professor-facing word follows `docs/professor-vocabulary.md` (page names, the
"Show to students" / "Hide from students" verb pair, status words, consequence dialogs,
one demo banner sentence). The rail is grouped Teach / Students / Courses / Less often.

| Route | Name and screen |
|---|---|
| `/professor` | **Home**: one lead sentence, one mint "Review {n} questions" button, a "Next step" card, three worded counts, "Waiting for you" by topic, recent decisions in plain verbs, a dismissible "How it works" strip, then Courses. |
| `/professor/review` | **Review questions**: opens on the first topic with waiting questions; "Question i of n" with Previous/Next; Approve (mint), Send back for changes, Rewrite with AI, Reject (with a confirmation), each with a one-sentence consequence; "Why?" and "Note (optional)" appear only when sending back or rejecting. |
| `/professor/questions` | **Question bank**: tabs All questions / Add a question (`?tab=bank|intake`); a four-column table (Question · Students · Actions) with four filters plus More filters; one labeled action per row plus a More menu; bulk bar "{n} selected". Add a question: Type or paste / Photo, "Create draft with AI" or "Fill in the details myself", one "Correct answer" field with advanced checking options collapsed. |
| `/professor/questions/[id]` | The question title: a status sentence, at most three buttons (Show to students or Approve · Edit question · Hide from students) plus More options; the student view; "More options and history" (extra practice, saved for later, all changes, technical details); "Which sections see this". |
| `/professor/upload` | **Upload notes**: preview-only wording, "Your lecture notes" (PDF or .tex, 500 KB) checked in the browser, "Upload and preview", results as Topics we found / Kinds of problems / Formulas / Common student mistakes. |
| `/professor/students`, `/[studentKey]` | **Students**: five columns (Student, Last active, Correct answers as "18 of 25 (72%)", Topics practiced, Needs attention) and "View record"; the record has "Name and email" with "Show name and email", "Answers per day, last 30 days" with printed counts, and "Credit suggestions by question". |
| `/professor/analytics` | **Class progress**: "Needs your attention" first, worded tiles, "Topics students find hardest", "Questions students find hardest"; the spreadsheet download sits under More options. |
| `/professor/feedback` | **Reports from students**: statuses New / Looking into it / Fixed / No change needed; each report links to its question; "Mark as fixed" / "No change needed". |
| `/professor/availability` | **What students see**: read-only rows with one "Change" button that opens a dialog ("Who can see this", "Show starting", "Hide after"); a consequence step before anything students will see; "Recent changes". |
| `/professor/content-transfer` | **Copy questions in or out**: "Check this file", a checkbox "I have checked the list above", "Add {n} questions"; one "Download approved questions" button with the rest under More options. |
| `/professor/courses/**` | **Courses** → course → **Section** (join code panel with Copy code and Show full screen) → **Choose questions** (see `docs/courses-sections-demo.md`). |

## Onboarding guide (`src/components/tour/`)

Two tooltip tours built on driver.js 1.8.0 (loaded lazily on the client, never in SSR or node tests),
chosen by the signed-in role and mounted once from the root layout (`TourProvider`). Each step dims
the page, lights one anchored element (`data-tour="…"`) that cannot be clicked, and shows a card
("Step n of 6", a headline of at most five words, one sentence, Skip tour · Back · Next/Done, no mint).
Escape ends it, arrow keys move, focus stays in the card, reduced motion is respected, and below 640px
the card docks as a bottom sheet.

- **Professor tour** (all on `/professor`): the Next step card, then the rail items Review questions,
  Question bank and Courses, the Students group, and the Account trigger. Below 1024px the rail steps
  fall back to the Menu button.
- **Student tour**: the Continue card and the syllabus on `/learn`, then a page hop to the first
  question for the answer block, the Hints → Steps row and the tutor (drawer, edge tab or phone chip),
  ending on the Account trigger. The step index survives the hop in sessionStorage.
- **Entry points**: auto-start once per role on the role's home page only (never on the landing page or
  for signed-out visitors), with a welcome card whose first button is "Not now"; "Onboarding guide" in
  the Account menu and on `/account` (`?guide=1` on the role's home page) reopens it any time.
  `localStorage["ai-tutor:guide:{role}"] = "seen"` records the first run.
- **Feedback**: the student account page shows a Feedback row (mailto link with a prefilled subject and a
  Copy email button) only when `FEEDBACK_EMAIL` is configured; see `docs/environment-configuration.md`.

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
