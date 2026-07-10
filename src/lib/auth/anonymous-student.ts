export const ANONYMOUS_STUDENT_STORAGE_KEY =
  "suffolk-tutor-anonymous-student-id"
export const ANONYMOUS_STUDENT_HEADER = "x-anonymous-student-id"
const TUTOR_SESSION_STORAGE_PREFIX = "suffolk-tutor-session:"

type AnonymousStudentStorage = Pick<Storage, "getItem" | "setItem">

type AnonymousStudentIdOptions = {
  createId?: () => string
  storage?: AnonymousStudentStorage
}

let ephemeralAnonymousStudentId: string | undefined

export function getOrCreateAnonymousStudentId(
  options: AnonymousStudentIdOptions = {},
) {
  const storage = options.storage ?? browserLocalStorage()
  let useEphemeralIdentity = !storage

  if (storage) {
    try {
      const existingId = storage.getItem(ANONYMOUS_STUDENT_STORAGE_KEY)
      if (isAnonymousStudentId(existingId)) {
        return existingId
      }
    } catch {
      useEphemeralIdentity = true
      if (ephemeralAnonymousStudentId) {
        return ephemeralAnonymousStudentId
      }
    }
  } else if (ephemeralAnonymousStudentId) {
    return ephemeralAnonymousStudentId
  }

  const nextId = options.createId?.() ?? createAnonymousStudentId()
  if (!isAnonymousStudentId(nextId)) {
    throw new Error("Anonymous student ID factory returned an invalid ID.")
  }

  if (storage) {
    try {
      storage.setItem(ANONYMOUS_STUDENT_STORAGE_KEY, nextId)
    } catch {
      useEphemeralIdentity = true
      // The in-memory ID still supports this page load when persistence fails.
    }
  }

  if (useEphemeralIdentity) {
    ephemeralAnonymousStudentId = nextId
  }

  return nextId
}

export function isAnonymousStudentId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 7 &&
    value.length <= 128 &&
    /^(?:anonymous-student|anon)-[a-z0-9][a-z0-9_-]*$/i.test(value)
  )
}

export function anonymousTutorSessionStorageKey(
  anonymousStudentId: string,
  questionId: string,
) {
  if (!isAnonymousStudentId(anonymousStudentId)) {
    throw new Error("A valid anonymous student ID is required.")
  }

  return `${TUTOR_SESSION_STORAGE_PREFIX}${anonymousStudentId}:${questionId}`
}

function createAnonymousStudentId() {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

  return `anonymous-student-${suffix}`
}

function browserLocalStorage(): AnonymousStudentStorage | undefined {
  if (typeof window === "undefined") {
    return undefined
  }

  try {
    return window.localStorage
  } catch {
    return undefined
  }
}
