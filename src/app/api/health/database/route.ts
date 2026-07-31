import { NextResponse } from "next/server"

import { checkPostgresHealth } from "@/lib/data/postgres"
import { getOperatingModePolicy } from "@/lib/runtime/operating-mode"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
}

export async function GET() {
  try {
    const policy = getOperatingModePolicy()

    if (policy.repositorySource === "demo") {
      return NextResponse.json(
        {
          database: {
            required: false,
            status: "disabled",
          },
          status: "healthy",
        },
        { headers: NO_STORE_HEADERS },
      )
    }

    const database = await checkPostgresHealth()

    if (database.status === "unavailable") {
      return NextResponse.json(
        {
          database: {
            category: database.category,
            required: true,
            status: database.status,
          },
          status: "unavailable",
        },
        { headers: NO_STORE_HEADERS, status: 503 },
      )
    }

    return NextResponse.json(
      {
        database: {
          latencyMs: database.latencyMs,
          required: true,
          status: database.status,
        },
        status: "healthy",
      },
      { headers: NO_STORE_HEADERS },
    )
  } catch {
    return NextResponse.json(
      {
        database: {
          category: "unavailable",
          required: true,
          status: "unavailable",
        },
        status: "unavailable",
      },
      { headers: NO_STORE_HEADERS, status: 503 },
    )
  }
}
