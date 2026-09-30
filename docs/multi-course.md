# Multiple courses

One platform hosts several courses. A **course** owns **topics**; a question's
course is its topic's course, so questions, tutor sessions, attempts, progress,
availability, similarity links, and retrieval chunks need no `course_id` of
their own. Migration `028_courses.sql` adds the `courses` table and
`topics.course_id`.

| Course | id | Code | Content |
| --- | --- | --- | --- |
| Probability & Statistics | `probability-statistics` | `MATH-255` | Existing topics and questions, unchanged. |
| Calculus I | `calculus-1` | none provided | Registered, with no topics or questions yet. |

## Rules the database enforces

- Every topic belongs to a registered course (`topics.course_id`, not null).
  Topics inserted without one land in Probability & Statistics during the
  transition, so existing importers and seeds are unchanged. Course-aware
  tooling passes the course explicitly.
- Topic order is a per-course sequence (`unique (course_id, sort_order)`).
- A topic cannot change course once a question, attempt, pattern, or retrieval
  chunk depends on it, and a question cannot move to a topic in another course.
- The public, review, reserve, and retrieval views expose `course_id`.

## Choosing a course

- Students pick a course at `/courses`. The choice is an httpOnly cookie
  (`ai-tutor-course`) read on the server. With no choice, or an unknown or
  inactive one, the course is Probability & Statistics.
- A direct link to a question or topic decides its own course; the remembered
  course follows it. Switching courses never changes progress, which is
  computed per course.
- Professors may work in any course. Their course filter scopes the question
  bank, review queue, availability, class progress, and Students pages. There
  are no per-course professor permissions yet.
- Retrieval never crosses courses: stored chunks, approved questions, review
  candidates, and local keyword chunks are all filtered by course. A request
  that names a topic uses that topic's course; one that names neither keeps
  the original course; a topic that cannot be placed matches nothing.

## Canonical syllabi

`data/canonical/<course id>/syllabus-topics.json`, one per course.
`npm run syllabus:sync -- --course <course id> [--apply]` synchronises one
course and never treats another course's topics as extra. Calculus I's file is
empty until the professor's syllabus is provided.
