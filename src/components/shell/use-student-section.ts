"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  parseJoinCode,
  SECTION_CODE_MALFORMED_MESSAGE,
  SECTION_CODE_UNKNOWN_MESSAGE,
} from "@/lib/tutor/section-content";

/** The student section API: GET the membership, POST a code, DELETE to leave. */
export const STUDENT_SECTION_API = "/api/student/section";

/**
 * The section a student joined, as the server reports it. `label` is the
 * chip's "MATH-255 · Section 1"; the parts are kept for screens that need
 * them (the account line prints when it was joined).
 */
export type StudentSection = {
  courseCode: string;
  courseTitle: string;
  joinedAt: string;
  label: string;
  sectionId: string;
  sectionLabel: string;
  term: string;
};

/** The header chip before a student has joined a section. */
export const UNJOINED_SECTION_LABEL = "MATH-255 · Guest";

/** Shown at the code field when a well-formed code is not a known section. */
export const SECTION_CODE_UNKNOWN_ERROR = SECTION_CODE_UNKNOWN_MESSAGE;

/** Shown when the code could not be checked (the service is unreachable). */
export const SECTION_JOIN_UNAVAILABLE_ERROR =
  "We couldn't join your section just now. Try again in a moment.";

/**
 * Anything typed or pasted → the printed `XXX-XX` shape ("k7q2m" →
 * "K7Q-2M"). The server applies the same rule, so the browser only checks
 * the shape; whether a code names a section is the server's answer.
 */
export function normalizeSectionCode(code: string) {
  return parseJoinCode(code) ?? code.trim().toUpperCase();
}

/** The server's section, or `null` for anything that is not one. */
export function studentSectionFromDto(value: unknown): StudentSection | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const dto = value as Record<string, unknown>;
  const text = (key: string) =>
    typeof dto[key] === "string" ? (dto[key] as string) : "";
  const sectionId = text("sectionId");
  const sectionLabel = text("sectionLabel");
  const courseCode = text("courseCode");
  if (!sectionId || !sectionLabel) {
    return null;
  }
  return {
    courseCode,
    courseTitle: text("courseTitle"),
    joinedAt: text("joinedAt"),
    label: courseCode ? `${courseCode} · ${sectionLabel}` : sectionLabel,
    sectionId,
    sectionLabel,
    term: text("term"),
  };
}

export type JoinSectionResult =
  | { ok: true; section: StudentSection }
  | {
      ok: false;
      /**
       * `malformed` and `unknown` belong at the code field; `signed_out`
       * means there is no student identity to join with yet;
       * `unavailable` is a service problem worth retrying.
       */
      reason: "malformed" | "signed_out" | "unavailable" | "unknown";
      message: string;
    };

// A module-level store rather than state-in-an-effect: every chip, account
// line and join form reads the same membership, it is fetched once per page
// load, and `useSyncExternalStore` gives a stable server snapshot so the
// markup matches before hydration.
type SectionSnapshot = {
  section: StudentSection | null;
  /** `ready` once the server has answered (or could not be reached). */
  status: "idle" | "loading" | "ready";
};

const SERVER_SNAPSHOT: SectionSnapshot = { section: null, status: "idle" };
const listeners = new Set<() => void>();
let snapshot: SectionSnapshot = SERVER_SNAPSHOT;
let loadGeneration = 0;

function setSnapshot(next: SectionSnapshot) {
  snapshot = next;
  for (const listener of listeners) {
    listener();
  }
}

async function loadSection() {
  const generation = ++loadGeneration;
  let section: StudentSection | null = null;
  try {
    const response = await fetch(STUDENT_SECTION_API, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    // 401 is a visitor with no student identity yet: simply not joined.
    if (response.ok) {
      const payload = (await response.json()) as { section?: unknown };
      section = studentSectionFromDto(payload?.section);
    }
  } catch {
    // Offline or the API is unreachable: the chip reads as not joined, and
    // nothing else on the page depends on it.
  }
  // A join or leave that finished meanwhile is newer than this read.
  if (generation === loadGeneration) {
    setSnapshot({ section, status: "ready" });
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (snapshot.status === "idle") {
    snapshot = { ...snapshot, status: "loading" };
    void loadSection();
  }
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return snapshot;
}

function getServerSnapshot() {
  return SERVER_SNAPSHOT;
}

async function errorMessageFrom(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: unknown };
    return typeof payload?.error === "string" && payload.error
      ? payload.error
      : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Joins the section a code names, on the server. The store updates on
 * success, so every chip and account line shows the new section at once.
 */
export async function joinStudentSection(
  rawCode: string,
): Promise<JoinSectionResult> {
  const code = parseJoinCode(rawCode);
  if (!code) {
    return {
      message: SECTION_CODE_MALFORMED_MESSAGE,
      ok: false,
      reason: "malformed",
    };
  }

  let response: Response;
  try {
    response = await fetch(STUDENT_SECTION_API, {
      body: JSON.stringify({ code }),
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  } catch {
    return {
      message: SECTION_JOIN_UNAVAILABLE_ERROR,
      ok: false,
      reason: "unavailable",
    };
  }

  if (response.ok) {
    let section: StudentSection | null = null;
    try {
      const payload = (await response.json()) as { section?: unknown };
      section = studentSectionFromDto(payload?.section);
    } catch {
      section = null;
    }
    if (!section) {
      return {
        message: SECTION_JOIN_UNAVAILABLE_ERROR,
        ok: false,
        reason: "unavailable",
      };
    }
    loadGeneration += 1;
    setSnapshot({ section, status: "ready" });
    return { ok: true, section };
  }

  if (response.status === 404) {
    return {
      message: await errorMessageFrom(response, SECTION_CODE_UNKNOWN_ERROR),
      ok: false,
      reason: "unknown",
    };
  }
  if (response.status === 400) {
    return {
      message: await errorMessageFrom(response, SECTION_CODE_MALFORMED_MESSAGE),
      ok: false,
      reason: "malformed",
    };
  }
  if (response.status === 401) {
    return {
      message: "Sign in first, then enter your section code.",
      ok: false,
      reason: "signed_out",
    };
  }
  return {
    message: SECTION_JOIN_UNAVAILABLE_ERROR,
    ok: false,
    reason: "unavailable",
  };
}

/** Leaves the student's section on the server. */
export async function leaveStudentSection(): Promise<boolean> {
  try {
    const response = await fetch(STUDENT_SECTION_API, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      method: "DELETE",
    });
    if (!response.ok) {
      return false;
    }
  } catch {
    return false;
  }
  loadGeneration += 1;
  setSnapshot({ section: null, status: "ready" });
  return true;
}

export type UseStudentSection = {
  section: StudentSection | null;
  join: (code: string) => Promise<JoinSectionResult>;
  leave: () => Promise<boolean>;
  /** Re-reads the membership from the server (after signing in, say). */
  refresh: () => Promise<void>;
  /** True once the server has answered; before that, render "not joined". */
  hydrated: boolean;
};

export function useStudentSection(): UseStudentSection {
  const current = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const join = useCallback((code: string) => joinStudentSection(code), []);
  const leave = useCallback(() => leaveStudentSection(), []);
  const refresh = useCallback(() => loadSection(), []);

  return {
    hydrated: current.status === "ready",
    join,
    leave,
    refresh,
    section: current.status === "ready" ? current.section : null,
  };
}

/** Test seam: forget the cached membership so the next mount refetches. */
export function resetStudentSectionStoreForTests() {
  loadGeneration += 1;
  snapshot = SERVER_SNAPSHOT;
  listeners.clear();
}
