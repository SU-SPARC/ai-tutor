export const ANONYMOUS_STUDENT_STORAGE_KEY =
  "suffolk-tutor-anonymous-student-id";
const TUTOR_SESSION_STORAGE_PREFIX = "suffolk-tutor-session:";

export function isAnonymousStudentId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 7 &&
    value.length <= 128 &&
    /^(?:anonymous-student|anon)-[a-z0-9][a-z0-9_-]*$/i.test(value)
  );
}

export function anonymousTutorSessionStorageKey(questionId: string) {
  if (!questionId.trim()) {
    throw new Error("A question ID is required.");
  }

  return `${TUTOR_SESSION_STORAGE_PREFIX}${questionId}`;
}

export function readLegacyAnonymousStudentId() {
  const storage = browserLocalStorage();
  if (!storage) {
    return undefined;
  }

  try {
    const value = storage.getItem(ANONYMOUS_STUDENT_STORAGE_KEY);
    return isAnonymousStudentId(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function clearLegacyAnonymousStudentId(legacyAnonymousId?: string) {
  try {
    if (legacyAnonymousId) {
      const legacySessionPrefix = `${TUTOR_SESSION_STORAGE_PREFIX}${legacyAnonymousId}:`;
      const sessionKeys: string[] = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith(legacySessionPrefix)) {
          sessionKeys.push(key);
        }
      }
      for (const key of sessionKeys) {
        window.localStorage.removeItem(key);
      }
    }
    window.localStorage.removeItem(ANONYMOUS_STUDENT_STORAGE_KEY);
  } catch {
    // A successful server exchange is sufficient even when local cleanup is
    // blocked by browser storage policy.
  }
}

function browserLocalStorage(): Pick<Storage, "getItem"> | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
