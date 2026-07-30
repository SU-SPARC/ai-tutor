# pf-xj-research

This project is a web-based AI tutoring system for probability and statistics students. The goal is to help students practice course problems with step-by-step guidance, hints, misconception feedback, and professor-approved explanations.

The system uses course materials, LaTeX questions, solutions, and examples as the primary knowledge base. A general LLM fallback may be used only when the professor-provided material is insufficient.

The final product will be a student-facing web application where users can:
- choose probability/statistics topics
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
handling rules.
