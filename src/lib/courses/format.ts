/**
 * Pure formatting helpers shared by every Courses & Sections screen.
 *
 * These live outside React on purpose: the seed builder, the reducer, and the
 * server components all need the same labels, and a professor comparing two
 * sections should never see the same value rendered two different ways.
 */

import type {
  CanonicalTopic,
  QuestionLifecycleState,
} from "@/lib/courses/types";

/**
 * Join codes are read aloud in a classroom and typed on a phone, so the
 * alphabet drops every glyph pair students confuse: I/1/L, O/0, S/5.
 */
const JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRTUVWXYZ2346789";

/** Join codes are grouped 3 + 2, matching the printed demo codes ("K7Q-2M"). */
const JOIN_CODE_HEAD = 3;
const JOIN_CODE_LENGTH = 5;

/**
 * FNV-1a. Not cryptographic — it only has to be stable across the server
 * render, the client render, and every test run, so the demo never flickers.
 */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function truncateTitle(title: string, maxLength: number) {
  const trimmed = title.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  const cut = trimmed.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  // Cut on a word boundary when one is close enough that the label still reads.
  const body = lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${body.replace(/[\s,;:]+$/, "")}…`;
}

/**
 * "Week 3 · Conditional Probability, Independence…" — the week number is what
 * a professor scans by, so it always survives truncation.
 */
export function topicShortLabel(
  topic: Pick<CanonicalTopic, "title" | "weekNumber">,
  maxLength = 34,
): string {
  return `Week ${topic.weekNumber} · ${truncateTitle(topic.title, maxLength)}`;
}

/** Normalize anything typed or pasted into the printed `XXX-XX` shape. */
export function formatJoinCode(raw: string): string {
  const cleaned = (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length <= JOIN_CODE_HEAD) {
    return cleaned;
  }
  return `${cleaned.slice(0, JOIN_CODE_HEAD)}-${cleaned.slice(JOIN_CODE_HEAD, JOIN_CODE_LENGTH)}`;
}

/**
 * Deterministic join code for a seed string (section id, or section id plus the
 * previous code when regenerating). Same seed always yields the same code, so
 * the demo state survives a reload without a random source.
 */
export function generateJoinCode(seedString: string): string {
  let hash = hashString(`join:${seedString}`);
  let code = "";
  for (let index = 0; index < JOIN_CODE_LENGTH; index += 1) {
    code += JOIN_CODE_ALPHABET[hash % JOIN_CODE_ALPHABET.length];
    hash = hashString(`${seedString}:${index}:${hash}`);
  }
  return formatJoinCode(code);
}

/**
 * Rosters are SHA-256 style keys, never names. Showing the first four hex
 * digits keeps rows distinguishable while making the anonymity obvious.
 */
export function shortStudentLabel(studentKey: string): string {
  const cleaned = (studentKey ?? "").trim();
  if (cleaned.length === 0) {
    return "Student —";
  }
  return `Student ${cleaned.slice(0, 4).toUpperCase()}`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Relative time against an explicit `now` so server and client agree and tests
 * stay deterministic. Future timestamps read "in 8d" (scheduled topics).
 */
export function formatRelativeTime(iso: string, now: string | Date): string {
  const then = new Date(iso).getTime();
  const reference =
    now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(then) || !Number.isFinite(reference)) {
    return "—";
  }

  const delta = reference - then;
  const magnitude = Math.abs(delta);
  const suffix = (value: string) =>
    delta < 0 ? `in ${value}` : `${value} ago`;

  if (magnitude < MINUTE_MS) {
    return "just now";
  }
  if (magnitude < HOUR_MS) {
    return suffix(`${Math.floor(magnitude / MINUTE_MS)}m`);
  }
  if (magnitude < DAY_MS) {
    return suffix(`${Math.floor(magnitude / HOUR_MS)}h`);
  }
  if (magnitude < 7 * DAY_MS) {
    return suffix(`${Math.floor(magnitude / DAY_MS)}d`);
  }
  if (magnitude < 35 * DAY_MS) {
    return suffix(`${Math.floor(magnitude / (7 * DAY_MS))}w`);
  }
  return suffix(`${Math.floor(magnitude / (30 * DAY_MS))}mo`);
}

/**
 * The professor's words for each lifecycle state. "Published" means ready to
 * use, not visible: a section still has to be chosen before students see it.
 */
const STATE_LABELS: Record<QuestionLifecycleState, string> = {
  draft: "Being written",
  needs_review: "Waiting for your review",
  approved: "Approved",
  published: "Ready to use",
  unpublished: "Hidden from students",
};

/** Lifecycle state as the professor panel says it, everywhere. */
export function stateLabel(state: QuestionLifecycleState): string {
  return STATE_LABELS[state] ?? "Unknown";
}

/**
 * Section labels read as words in prose: "Sec 01" → "Section 1". Anything the
 * professor typed that is not the short form ("Tue/Thu 10am") is kept as is.
 */
export function friendlySectionLabel(label: string): string {
  const trimmed = (label ?? "").trim();
  const match = /^sec(?:tion)?\.?\s*0*(\d+)$/i.exec(trimmed);
  return match ? `Section ${match[1]}` : trimmed;
}
