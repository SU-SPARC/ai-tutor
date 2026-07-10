import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { GET } from "@/app/api/professor/usage/route"
import { resetUsageControlForTests } from "@/lib/tutor/usage-control"

describe("professor usage API", () => {
  beforeEach(() => {
    resetUsageControlForTests()
    vi.stubEnv("ADMIN_SECRET", "review-secret")
    vi.stubEnv("APP_DEMO_MODE", "true")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("requires the existing professor token and returns aggregate usage", async () => {
    const unauthenticated = await GET(
      new Request("http://localhost/api/professor/usage"),
    )
    const authenticated = await GET(
      new Request("http://localhost/api/professor/usage", {
        headers: { "x-professor-token": "review-secret" },
      }),
    )

    expect(unauthenticated.status).toBe(401)
    expect(authenticated.status).toBe(200)
    await expect(authenticated.json()).resolves.toMatchObject({
      usage: {
        mode: "demo",
        today: {
          llmCalls: 0,
        },
      },
    })
  })
})
