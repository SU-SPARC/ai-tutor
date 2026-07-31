import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const postgresMocks = vi.hoisted(() => ({
  checkPostgresHealth: vi.fn(),
}))

vi.mock("@/lib/data/postgres", () => postgresMocks)

import { GET as getDatabaseHealth } from "@/app/api/health/database/route"

describe("database health API", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ENV", "test")
    vi.stubEnv("APP_DEMO_MODE", "false")
    vi.stubEnv(
      "DATABASE_URL",
      "postgres://runtime:secret@db.example.test/tutor",
    )
    postgresMocks.checkPostgresHealth.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("returns a non-cached healthy readiness result", async () => {
    postgresMocks.checkPostgresHealth.mockResolvedValue({
      latencyMs: 12,
      status: "healthy",
    })

    const response = await getDatabaseHealth()

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({
      database: {
        latencyMs: 12,
        required: true,
        status: "healthy",
      },
      status: "healthy",
    })
  })

  it("returns 503 for a failed connection without exposing its URL", async () => {
    postgresMocks.checkPostgresHealth.mockResolvedValue({
      category: "unavailable",
      status: "unavailable",
    })

    const response = await getDatabaseHealth()
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toEqual({
      database: {
        category: "unavailable",
        required: true,
        status: "unavailable",
      },
      status: "unavailable",
    })
    expect(JSON.stringify(body)).not.toMatch(
      /runtime|secret|db\.example\.test/i,
    )
  })

  it("does not probe a database in explicit demo mode", async () => {
    vi.stubEnv("APP_DEMO_MODE", "true")

    const response = await getDatabaseHealth()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      database: {
        required: false,
        status: "disabled",
      },
      status: "healthy",
    })
    expect(postgresMocks.checkPostgresHealth).not.toHaveBeenCalled()
  })
})
