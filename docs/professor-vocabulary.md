# Professor vocabulary and interaction patterns

Companion to `docs/ui-redesign-demo.md`. This is the contract for every string and control a
professor sees under `/professor`. The audience is professors who are not comfortable with
technology, many of them older. They will not read documentation, they do not know software
vocabulary, and they are anxious about accidentally showing something to students.

Three rules cover most cases:

1. Say what happens to students. "Show to students", not "publish"; "Hidden from students", not
   "unpublished".
2. One word per concept, everywhere: rail label, page title, breadcrumb, button, chip and toast.
3. Anything students will see, or that cannot be undone, asks first in one plain sentence.

## Page names

The rail label, the `h1`, the breadcrumb, the document title and every button that links to the
page use the same words.

| Route | Name |
| --- | --- |
| `/professor` | Home |
| `/professor/review` | Review questions |
| `/professor/questions` | Question bank (tabs: All questions · Add a question) |
| `/professor/questions/[id]` | the question's title |
| `/professor/upload` | Upload notes |
| `/professor/students` | Students |
| `/professor/analytics` | Class progress |
| `/professor/feedback` | Reports from students |
| `/professor/availability` | What students see |
| `/professor/content-transfer` | Copy questions in or out |
| `/professor/courses` | Courses |
| `/professor/courses/[id]/topics` | Choose questions |
| header link to `/learn` (professors) | Student view |

The rail is grouped: **Teach** (Home, Review questions, Question bank, What students see),
**Students** (Students, Class progress, Reports from students), **Courses**, and **Less often**
(Upload notes, Copy questions in or out). A count badge appears only when something needs the
professor ("12 waiting"), never for totals.

## One verb pair for visibility

- Making a question reachable by students (lifecycle publish, per-section release, global
  availability): **Show to students**, or "Show to Section 1" when a section is named.
- Stopping students from seeing it: **Hide from students**.

Publish, unpublish, release, available, availability, live, withheld, held back and gate do not
appear in professor-visible text. "Approve" stays: professors say it.

## Status words

| Internal state | Professor label |
| --- | --- |
| `draft` | Being written |
| `needs_review` | Waiting for your review |
| `revision_requested` | Sent back for changes |
| `approved`, not published | Approved, not yet shown to students (chip: Approved) |
| `published` and visible | Students can see it |
| `unpublished` | Hidden from students |
| `rejected` | Rejected |
| `archived` | Removed from question bank |
| reserved | Saved for later |
| scheduled | Students will see it on {date} |
| topic open / closed (courses) | Students can see this week: Yes / No / From {date} |
| section on an older version | Shown (older version) |
| held (version withdrawn) | Paused: this version was withdrawn |

## Action labels

| Was | Is |
| --- | --- |
| Request edit / Request revision | Send back for changes |
| Request regeneration / Regenerate | Rewrite with AI |
| Archive / Restore | Remove from question bank / Put back |
| Roll back | Go back to version {n} |
| Reserve / Remove reserve | Save for later / Take out of Saved for later |
| Mark this version inspected | Mark as checked |
| Edit published question, Create revision draft | Edit question |
| Save revision draft / Save draft | Save changes / Save question |
| Analyze question | Create draft with AI |
| Continue manually | Fill in the details myself |
| Preview extraction | Upload and preview |
| Reveal identity | Show name and email |
| Clone (course) | Copy for a new term |
| Regenerate join code | Make a new join code |
| Export CSV, Download research export | Download spreadsheet (no student names) |
| Confirm, Submit, OK | never: the button restates the action ("Show 3 questions to students") |

Field labels follow the same idea: "Why?" and "Note (optional)" (helper: "Only instructors see
this.") instead of "Decision reason" and "Audit note"; "Correct answer" and "Other answers to
accept" instead of "Canonical answer" and "Aliases"; "Who can see this" instead of "Student release
state". Review reasons keep their codes and read as sentences a professor would say ("Same as
another question", "Answer is wrong", "Wording is unclear", "Belongs in a different topic", "Hints
need work", "Problem with where it came from", "Not covered in my course", "Something else (please
explain)"). Report statuses are New, Looking into it, Fixed, No change needed.

## Patterns

**Consequence dialog.** Required before anything students will see and before anything that
cannot be undone (Show, Hide, Reject, Remove, Rewrite with AI, Go back to a version, Archive a
course, Discard changes, Reset demo). The title is a question ("Show this question to students?").
The body is one sentence naming who and what ("Students in Section 1 will see “Two dice sum to 7”
starting now."). The safe option comes first as a secondary button ("Keep hidden", "Cancel"), then
the action button restates the action. Reason and note fields live inside the dialog; there is no
standing "reason for your next decision" panel on any page.

**Toast.** Every action is spoken back with its consequence: "Approved “{title}”. Students can't see
it until you show it to them." Undo is offered wherever the code can reverse the action.

**Errors.** "That didn't work and nothing changed. Try again, or reload the page." Field problems
appear next to the field. Internal names (lifecycle, transition, MIME, storage paths, audit ids)
never appear.

**Demo banner.** One sentence, identical everywhere, in the `PageHeader` notice slot: "Demo:
changes on this page are not saved."

**Empty states.** One sentence about what will appear here, plus one button naming the next action.

**Numbers.** Always wrapped in words ("12 waiting for your review"), never a bare number over a
13px caption.

**Dates.** A missing date, or epoch zero, renders nothing. Times are shown in the browser's zone
with its short name.

**Type and targets.** On professor screens, text that carries meaning is `type-body` (16px) in
ink; `type-small` is for timestamps and secondary detail only. Controls are at least 44px
(`min-h-11`). No icon-only buttons. Nothing meaningful lives only in a hover `title`.

**Progressive disclosure.** A screen's default view shows at most three actions. Rare actions go in
a "More options" menu or a `details` block with a plain title ("More options and history",
"Technical details"). Version numbers, question codes and ids live under "Technical details".

**Abbreviations.** "Week 3" and "Section 1" in headings and prose. "Wk" is allowed only inside a
dense table whose header says "Week".

**Onboarding guide.** Six tooltips on Home, in these words: "Start here", "Approve or send back",
"Show to students", "Sections and join codes", "How your class is doing", "Come back any time". It runs
once on a professor's first visit to Home and can be reopened from Account → Onboarding guide.
