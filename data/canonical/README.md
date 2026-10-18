# Canonical syllabus topics

One folder per course, named by the course id registered in the `courses`
table (migration 028):

- `probability-statistics/syllabus-topics.json` — Probability & Statistics.
- `calculus-1/syllabus-topics.json` — Calculus I. One topic per line of the
  professor's spring schedule, with the text sections it lists. Topic ids are
  prefixed `calc1-`.

Each file is an array of topics in strictly increasing syllabus `order`. Topic
ids are global (they are the `topics.id` primary key), so a new course's ids must
not collide with another course's. Order is per course.

Synchronise one course at a time:

    npm run syllabus:sync -- --course calculus-1
    npm run syllabus:sync -- --course calculus-1 --apply

The default course is `probability-statistics`.
