import { describe, expect, it, vi } from "vitest"

import {
  ANONYMOUS_STUDENT_STORAGE_KEY,
  anonymousTutorSessionStorageKey,
  getOrCreateAnonymousStudentId,
  isAnonymousStudentId,
} from "@/lib/auth/anonymous-student"

describe("anonymous student identity", () => {
  it("creates one opaque ID and reuses it from local storage", () => {
    const storage = createMemoryStorage()
    const createId = vi.fn(() => "anonymous-student-test-123")

    const created = getOrCreateAnonymousStudentId({ createId, storage })
    const resumed = getOrCreateAnonymousStudentId({ createId, storage })

    expect(created).toBe("anonymous-student-test-123")
    expect(resumed).toBe(created)
    expect(createId).toHaveBeenCalledTimes(1)
    expect(storage.value()).toBe(created)
  })

  it("replaces malformed or identifying-looking stored values", () => {
    const storage = createMemoryStorage("student@example.test")

    const studentId = getOrCreateAnonymousStudentId({
      createId: () => "anonymous-student-replacement-123",
      storage,
    })

    expect(studentId).toBe("anonymous-student-replacement-123")
    expect(studentId).not.toContain("@")
    expect(storage.value()).toBe(studentId)
  })

  it("returns an ephemeral ID when browser storage is unavailable", () => {
    const storage = {
      getItem() {
        throw new Error("storage disabled")
      },
      setItem() {
        throw new Error("storage disabled")
      },
    }

    const createId = vi.fn(() => "anonymous-student-ephemeral-123")
    const created = getOrCreateAnonymousStudentId({ createId, storage })
    const resumed = getOrCreateAnonymousStudentId({ createId, storage })

    expect(created).toBe("anonymous-student-ephemeral-123")
    expect(resumed).toBe(created)
    expect(createId).toHaveBeenCalledTimes(1)
  })

  it("accepts only bounded opaque identifier characters", () => {
    expect(isAnonymousStudentId("anonymous-student-valid-123")).toBe(true)
    expect(isAnonymousStudentId("student@example.test")).toBe(false)
    expect(isAnonymousStudentId("Jane Student")).toBe(false)
    expect(isAnonymousStudentId("short")).toBe(false)
  })

  it("scopes saved tutor sessions to the anonymous identity and question", () => {
    const firstStudentKey = anonymousTutorSessionStorageKey(
      "anonymous-student-first-123",
      "dice-sum-eight",
    )
    const secondStudentKey = anonymousTutorSessionStorageKey(
      "anonymous-student-second-123",
      "dice-sum-eight",
    )

    expect(firstStudentKey).toContain("anonymous-student-first-123")
    expect(firstStudentKey).toContain("dice-sum-eight")
    expect(secondStudentKey).not.toBe(firstStudentKey)
  })
})

function createMemoryStorage(initialValue?: string) {
  let storedValue = initialValue

  return {
    getItem(key: string) {
      return key === ANONYMOUS_STUDENT_STORAGE_KEY
        ? (storedValue ?? null)
        : null
    },
    setItem(key: string, value: string) {
      if (key === ANONYMOUS_STUDENT_STORAGE_KEY) {
        storedValue = value
      }
    },
    value() {
      return storedValue
    },
  }
}
