"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

import { useIsHydrated } from "@/lib/use-is-hydrated";

export const STUDENT_SECTION_STORAGE_KEY = "ai-tutor-student-section";

export type StudentSection = {
  code: string;
  label: string;
};

/**
 * The demo's join codes. There is no sections API on the student side yet, so
 * the mapping is a static table: a code a student was given in class turns
 * into the section name they recognise. A code that is not in the table is
 * refused at the field (`SECTION_CODE_UNKNOWN_ERROR`) instead of "joining" a
 * section nobody can name.
 */
const SECTION_LABELS: Record<string, string> = {
  "K7Q-2M": "MATH-255 · Section 1",
  "R4N-8X": "MATH-255 · Section 2",
};

/** The header chip before a student has joined a section. */
export const UNJOINED_SECTION_LABEL = "MATH-255 · Guest";

/** Shown at the code field when a well-formed code is not a known section. */
export const SECTION_CODE_UNKNOWN_ERROR =
  "We don't recognise that code. Check it with your professor.";

export function normalizeSectionCode(code: string) {
  return code.trim().toUpperCase();
}

/** True when the code (any case) names one of the course's sections. */
export function isKnownSectionCode(code: string) {
  return Object.hasOwn(SECTION_LABELS, normalizeSectionCode(code));
}

/**
 * "MATH-255 · Section 1" for a known code. An unknown code (for example one
 * stored before codes were checked) reads as not joined.
 */
export function sectionLabelForCode(code: string) {
  return SECTION_LABELS[normalizeSectionCode(code)] ?? UNJOINED_SECTION_LABEL;
}

// A module-level store rather than state-in-an-effect: every chip and every
// join form reads the same value, and `useSyncExternalStore` gives a stable
// server snapshot so the markup matches before hydration.
const listeners = new Set<() => void>();
let snapshot: string | null = null;
let readFromStorage = false;

function readStoredCode(): string | null {
  try {
    const stored = window.localStorage.getItem(STUDENT_SECTION_STORAGE_KEY);
    return stored ? normalizeSectionCode(stored) : null;
  } catch {
    // Private browsing and blocked site data both throw on access. A student
    // without storage just never appears joined; nothing else breaks.
    return null;
  }
}

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STUDENT_SECTION_STORAGE_KEY) {
      snapshot = readStoredCode();
      emit();
    }
  };

  window.addEventListener("storage", handleStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

function getSnapshot() {
  if (!readFromStorage) {
    snapshot = readStoredCode();
    readFromStorage = true;
  }
  return snapshot;
}

function getServerSnapshot(): string | null {
  return null;
}

export type UseStudentSection = {
  section: StudentSection | null;
  setSection: (code: string) => void;
  clear: () => void;
  hydrated: boolean;
};

export function useStudentSection(): UseStudentSection {
  const code = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const hydrated = useIsHydrated();

  const setSection = useCallback((next: string) => {
    const normalized = normalizeSectionCode(next);
    if (!normalized) {
      return;
    }
    try {
      window.localStorage.setItem(STUDENT_SECTION_STORAGE_KEY, normalized);
    } catch {
      // Keep the in-memory value so the current visit still reads as joined.
    }
    snapshot = normalized;
    readFromStorage = true;
    emit();
  }, []);

  const clear = useCallback(() => {
    try {
      window.localStorage.removeItem(STUDENT_SECTION_STORAGE_KEY);
    } catch {
      // Ignored for the same reason as above.
    }
    snapshot = null;
    readFromStorage = true;
    emit();
  }, []);

  // A stored code that is not a known section (saved before codes were
  // checked) counts as not joined, so no screen prints a section nobody has.
  const section = useMemo<StudentSection | null>(
    () =>
      code && isKnownSectionCode(code)
        ? { code, label: sectionLabelForCode(code) }
        : null,
    [code],
  );

  return { section, setSection, clear, hydrated };
}
