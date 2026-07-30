import "server-only"

import { NextResponse } from "next/server"

import {
  DATA_SERVICE_UNAVAILABLE_CODE,
  DATA_SERVICE_UNAVAILABLE_MESSAGE,
} from "@/lib/data/service-error"

export function dataServiceUnavailableResponse() {
  return NextResponse.json(
    {
      code: DATA_SERVICE_UNAVAILABLE_CODE,
      error: DATA_SERVICE_UNAVAILABLE_MESSAGE,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
      status: 503,
    },
  )
}
