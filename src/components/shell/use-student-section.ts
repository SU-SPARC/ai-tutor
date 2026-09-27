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
 * into the section name they recognise, and anything else still joins (the
 * section number is simply unknown) rather than being rejected.
 */
const SECTION_LABELS: Record<string, string> = {
  "K7Q-2M": "MATH-255 · Sec 01",
  "R4N-8X": "MATH-255 · Sec 02",
};

export const UNJOINED_SECTION_LABEL = "MATH-255 · Fall 2026";

export function normalizeSectionCode(code: string) {
  return code.trim().toUpperCase();
}

export function sectionLabelForCode(code: string) {
  return SECTION_LABELS[normalizeSectionCode(code)] ?? "MATH-255 · Sec ??";
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

  const section = useMemo<StudentSection | null>(
    () => (code ? { code, label: sectionLabelForCode(code) } : null),
    [code],
  );

  return { section, setSection, clear, hydrated };
}
