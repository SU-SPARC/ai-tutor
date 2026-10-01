# pf-xj-research

This project is a web-based AI tutoring platform that hosts more than one course (currently Probability & Statistics, with Calculus I being added; see [`docs/multi-course.md`](docs/multi-course.md)). The goal is to help students practice course problems with step-by-step guidance, hints, misconception feedback, and professor-approved explanations.

The system uses course materials, LaTeX questions, solutions, and examples as the primary knowledge base. A general LLM fallback may be used only when the professor-provided material is insufficient.

The final product will be a student-facing web application where users can:

- choose a course and its topics
- practice problems
- submit answers
- receive hints
- get step-by-step explanations
- receive feedback on common misconceptions

The project will also include a structured data pipeline for converting professor-provided LaTeX materials into usable tutoring data.

## Configuration

Server configuration distinguishes Development, automated Test, Preview,
Staging, and Production. Start with `.env.example` and see
[`docs/environment-configuration.md`](docs/environment-configuration.md) for
the complete variable inventory, strict deployment requirements, and secret
handling rules. See
[`docs/operating-modes.md`](docs/operating-modes.md) for demo isolation and
database-failure behavior. Provider registration, callback URLs, roles, local
test identities, recovery, and privacy decisions are documented in
[`docs/authentication-authorization.md`](docs/authentication-authorization.md).
Professor review, immutable question versions, publication, takedown,
regeneration, rollback, and audit are specified in
[`docs/content-lifecycle.md`](docs/content-lifecycle.md).
The words and interaction patterns every professor-facing screen must use are
specified in [`docs/professor-vocabulary.md`](docs/professor-vocabulary.md).
The student-facing words and patterns are in
[`docs/student-vocabulary.md`](docs/student-vocabulary.md).
