import type { RetrievalChunk } from "@/lib/types";

/**
 * Retrieval chunks are internal grounding records. Their bodies carry
 * machine prefixes ("Misconception <id>: ... Feedback: ...", "Hint 2: ...")
 * that must never reach a student. This module turns one approved chunk into
 * a short piece of tutoring language and strips internal identifiers.
 */

type GuidanceKind =
  | "concept"
  | "hint"
  | "misconception"
  | "question"
  | "solution";

const LEAD_IN: Record<GuidanceKind, string> = {
  concept: "Here's a related idea from the course: ",
  hint: "Here's a hint from a similar problem: ",
  misconception: "Here's another way to think about it: ",
  question: "Compare with this related problem: ",
  solution: "Here's how a related problem is solved: ",
};

const GENERIC_GUIDANCE =
  "Take another look at the idea behind this question, then try again.";

const MISCONCEPTION_PREFIX = /^misconception\b[^:]*:\s*/i;
const FEEDBACK_MARKER = /\bfeedback:\s*/gi;
const HINT_PREFIX = /^hint\s*\d*\s*:\s*/i;
const SOLUTION_STEP_PREFIX = /^solution step\s*\d*\s*:\s*/i;
const SOLUTION_SUMMARY_PREFIX = /^solution summary:\s*/i;
const QUESTION_PREFIX = /^question:\s*/i;

const MISCONCEPTION_ID = /\bmisconception-[a-z0-9]+(?:-[a-z0-9]+)*/gi;
const QUESTION_CHUNK_ID = /\bquestion-chunk:[^\s,;)]+/gi;
const HAS_INTERNAL_ID =
  /\b(?:misconception-[a-z0-9]+(?:-[a-z0-9]+)*|question-chunk:[^\s,;)]+)/i;

/**
 * Removes internal identifier tokens (misconception slugs, chunk ids) from
 * text that is about to be shown to a student. Ordinary prose is untouched.
 */
export function scrubInternalIdentifiers(text: string) {
  if (!HAS_INTERNAL_ID.test(text)) {
    return text;
  }

  return text
    .replace(QUESTION_CHUNK_ID, "")
    .replace(MISCONCEPTION_ID, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Builds the student-facing sentence for an approved retrieval chunk. The
 * chunk's internal prefix, matcher triggers, and ids stay server-side.
 */
export function retrievalGuidanceForStudent(
  chunk: Pick<RetrievalChunk, "body" | "chunkType">,
) {
  const { kind, text } = studentTextForChunk(chunk);
  const body = scrubInternalIdentifiers(text);

  if (!body) {
    return GENERIC_GUIDANCE;
  }

  return `${LEAD_IN[kind]}${body}`;
}

function studentTextForChunk(
  chunk: Pick<RetrievalChunk, "body" | "chunkType">,
): { kind: GuidanceKind; text: string } {
  const body = chunk.body.trim();

  if (MISCONCEPTION_PREFIX.test(body)) {
    const markers = [...body.matchAll(FEEDBACK_MARKER)];
    const last = markers.at(-1);
    const feedback =
      last?.index !== undefined
        ? body.slice(last.index + last[0].length)
        : body.replace(MISCONCEPTION_PREFIX, "");
    return { kind: "misconception", text: feedback };
  }

  if (HINT_PREFIX.test(body)) {
    return { kind: "hint", text: body.replace(HINT_PREFIX, "") };
  }

  if (SOLUTION_STEP_PREFIX.test(body)) {
    return { kind: "solution", text: body.replace(SOLUTION_STEP_PREFIX, "") };
  }

  if (SOLUTION_SUMMARY_PREFIX.test(body)) {
    return {
      kind: "solution",
      text: body.replace(SOLUTION_SUMMARY_PREFIX, ""),
    };
  }

  if (QUESTION_PREFIX.test(body)) {
    return { kind: "question", text: body.replace(QUESTION_PREFIX, "") };
  }

  return { kind: kindForChunkType(chunk.chunkType), text: body };
}

function kindForChunkType(
  chunkType: RetrievalChunk["chunkType"],
): GuidanceKind {
  switch (chunkType) {
    case "misconception":
      return "misconception";
    case "hint":
      return "hint";
    case "question":
      return "question";
    case "solution_step":
    case "solution_summary":
      return "solution";
    default:
      return "concept";
  }
}
