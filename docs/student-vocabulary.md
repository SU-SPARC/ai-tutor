# Student vocabulary and interaction patterns

Companion to `docs/ui-redesign-demo.md` and `docs/professor-vocabulary.md`. This is the contract
for every word and control a student meets on `/`, `/join`, `/learn`, `/learn/[topic]`, `/practice`,
`/onboarding` and `/account`. Students are comfortable with apps but impatient, often on a phone, and
they want three answers at every moment: where am I, what do I do next, how am I doing.

## Words

| Concept | Use | Never |
| --- | --- | --- |
| a week | "Week 3" | "Wk 3" (only the bare number in the rail, under the "Syllabus" label) |
| the next thing to do (marker) | "Up next" | "You are here", "Next new", "Start here", "Resume" |
| the next thing to do (button) | "Start question n" / "Continue question n" / "Next question" (adjacent) / "Next unsolved" / "Next topic: Week n · title" | "Finish topic" as a primary, "Practice another topic" |
| progress | "2 of 6 solved", always visible | "done", "completed", "problems" |
| a question | "question" | "problem", "item", "sheet" |
| hints | "Hint 1 of 3", "Show hint 2 of 3" | a bare lightbulb, "Reveal" |
| steps | "Show steps", "Steps unlock after hint 3", "Steps ready" | a gate sentence as the only signal |
| a removed question | "No longer available" (neutral chip) with "removed by your professor · your answers are kept" | "Retired", a red chip |
| extra practice | "Extra practice" with "More questions like these. They don't change your syllabus progress." | "reserve", "similar practice", "partial credit" |
| the guest state | "Guest · your progress lives in this browser." with "Sign in to keep it" and "Have a section code? Enter it" | "anonymous", "demo session", "Ghost Student" |
| a section | "Section 1"; unjoined chip "MATH-255 · Guest"; unknown codes refused at the field | "Sec 01", "Sec ??" |
| back to the course home | "Back to Learn" | "View your progress", "Browse topics", "Go to Learn" |
| the professor | "your professor" | "instructor" |
| question codes, answer-type words, version numbers | hidden; the code appears only in the report-a-problem caption | headers, rows, cards, tutor chips |
| privacy | "Your professor sees you as a code (like Student 8F2A); your name is shown only if they open your record, and that is logged." | "never your name", "hashed key", "pseudonymous" |
| errors | "That didn't work and nothing changed. Try again, or reload the page." | "session", "resubmitting", "loaded safely" |

## Patterns

**One mint per screen.** On practice: Check answer, then Next question (or Next topic) after a correct
answer. When the page provides the bottom action strip, the keypad hides its own Check key.

**The verdict band carries the next action.** Correct: "Correct" and Next question. Wrong: "Not quite",
one kind sentence, and "Show hint n of m" (or "Show steps"); the disabled primary reads "Edit your
answer to check again". Wrong stays red, the wording stays kind.

**Hints and steps are a visible sequence** whenever a question has hints: three amber rungs that fill
as hints open, then a Steps pip labelled "Steps unlock after hint 3" and later "Steps ready".

**Orientation.** The Sheet header reads "Week 3 · topic · Question 1 of 6 · Intro". On phones the top
bar reads "‹ Question 1 of 6 ›" with 44px chevrons; the label opens the jump list. Alt+← and Alt+→
move between questions on desktop.

**Completion is never a dead end.** A finished topic offers "Next topic: Week n · title →" (or "Back to
Learn"). A finished course says "You've solved every question on the syllabus." with "Keep practicing".

**Guest truth.** Guest status comes from who owns the progress, not from whether progress exists.
The guest line shows on Learn and topic pages, the chip says "MATH-255 · Guest", and a guest can
always reach the section-code form ("Join your section" on `/join`, "Change section" on the account).

**Onboarding in one breath.** "Before you start", one paragraph (what is saved, the code your professor
sees, AI help is optional and can be wrong), one button "Got it, start practicing", the full notice
under "Read the full notice", and the import panel only when there is guest practice to bring over.

**Phone first.** Primary actions in the thumb zone, the tutor sheet no taller than 45svh with the
prompt's first line and "Your answer: …" visible, the keypad never covering the verdict band (after a
check on touch, focus moves to the band), targets at least 44px, "Up next" visible at every width.

**Recoverability.** Solved marks come from the server on every visit; a draft answer survives a reload;
Start over asks first ("Your earlier answers stay saved. Hints and steps close again.").

**Course home.** Continue card and syllabus first; "This week" as one plain line; no trackers for a guest
who has solved nothing; no duplicate syllabus rail on desktop; toolbars only when a list has more than
eight items; the shuffle control is labelled "Random question".

**Order inside a topic.** Syllabus order, then Intro → Core → Stretch, then title, in both the Learn
model and the server progress ordering.

**Landing page before sign-in.** A signed-out visitor sees a sample problem but cannot answer it: the
field is disabled ("Join your course to answer"), there is no Check, hints say "Sign in or join your
course to open hints.", the tutor says "Sign in or join your course to use the tutor.", and one outline
"Join to answer" button scrolls to the section-code form. The hero's second line reads "No code? Sign in,
or continue as a guest."

**Onboarding guide.** The tour's words follow this document: "Pick up here", "Your course, week by week",
"Type your answer", "Hints before answers", "Ask the tutor", "Come back any time". The Account menu item
is "Onboarding guide" with the helper "Tooltips that show you around". The welcome card offers "Not now"
before "Take the tour".

**Feedback.** The account page says "Send all feedback to {name}." with the address as the link and a
"Copy email" button; the name and address come from configuration, never from code.
