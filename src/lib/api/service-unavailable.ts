import "server-only"

import { NextResponse } from "next/server"

import {
  DATA_SERVICE_UNAVAILABLE_CODE,
  DATA_SERVICE_UNAVAILABLE_MESSAGE,
  DataServiceUnavailableError,
} from "@/lib/data/service-error"
import {
  logPilotOperationalEvent,
  pilotRequestId,
  type PilotOperationalEvent,
  type PilotOperationalSubsystem,
} from "@/lib/observability/pilot-operations"

export const AUTHENTICATION_SERVICE_UNAVAILABLE_CODE =
  "AUTHENTICATION_SERVICE_UNAVAILABLE"
export const AUTHENTICATION_SERVICE_UNAVAILABLE_MESSAGE =
  "Sign-in is temporarily unavailable. Please try again shortly."
export const RETRIEVAL_SERVICE_UNAVAILABLE_CODE =
  "RETRIEVAL_SERVICE_UNAVAILABLE"
export const RETRIEVAL_SERVICE_UNAVAILABLE_MESSAGE =
  "Additional course guidance is temporarily unavailable. Your saved progress was not changed. Please try again shortly."

type ServiceUnavailableResponseOptions = {
  cause?: unknown
  request?: Request
  requestId?: string
  route?: string
  subsystem?: PilotOperationalSubsystem
}

type SafeApiErrorResponseOptions = ServiceUnavailableResponseOptions & {
  code: string
  error: string
  event?: PilotOperationalEvent
  retryAfterSeconds?: number
  status: number
}

export function safeApiErrorResponse(options: SafeApiErrorResponseOptions) {
  const requestId = options.requestId ?? pilotRequestId(options.request)
  if (options.event) {
    logPilotOperationalEvent({
      cause: options.cause,
      event: options.event,
      requestId,
      route: options.route ?? "unknown",
      status: options.status,
      subsystem: options.subsystem,
    })
  }

  return NextResponse.json(
    { code: options.code, error: options.error },
    {
      headers: {
        "Cache-Control": "no-store",
        ...(options.retryAfterSeconds
          ? { "Retry-After": String(options.retryAfterSeconds) }
          : {}),
        "X-Request-Id": requestId,
      },
      status: options.status,
    },
  )
}

export function dataServiceUnavailableResponse(
  options: ServiceUnavailableResponseOptions = {},
) {
  const subsystem =
    options.subsystem ??
    (options.cause instanceof DataServiceUnavailableError
      ? options.cause.subsystem
      : undefined)
  const retrievalUnavailable = subsystem === "retrieval"
  return unavailableResponse({
    ...options,
    code: retrievalUnavailable
      ? RETRIEVAL_SERVICE_UNAVAILABLE_CODE
      : DATA_SERVICE_UNAVAILABLE_CODE,
    event: retrievalUnavailable
      ? "retrieval_unavailable"
      : "data_service_unavailable",
    message: retrievalUnavailable
      ? RETRIEVAL_SERVICE_UNAVAILABLE_MESSAGE
      : DATA_SERVICE_UNAVAILABLE_MESSAGE,
    subsystem,
  })
}

export function authenticationServiceUnavailableResponse(
  options: ServiceUnavailableResponseOptions = {},
) {
  return unavailableResponse({
    ...options,
    code: AUTHENTICATION_SERVICE_UNAVAILABLE_CODE,
    event: "authentication_unavailable",
    message: AUTHENTICATION_SERVICE_UNAVAILABLE_MESSAGE,
    subsystem: "authentication",
  })
}

export function tutorSessionUnavailableResponse(
  options: ServiceUnavailableResponseOptions = {},
) {
  return safeApiErrorResponse({
    ...options,
    code: "TUTOR_SESSION_UNAVAILABLE",
    error:
      "This tutor session is no longer available. It may have expired or its question may no longer be published.",
    event: "session_unavailable",
    status: 404,
    subsystem: "tutor-session",
  })
}

function unavailableResponse(
  options: ServiceUnavailableResponseOptions & {
    code: string
    event: PilotOperationalEvent
    message: string
  },
) {
  const requestId = options.requestId ?? pilotRequestId(options.request)
  logPilotOperationalEvent({
    cause: options.cause,
    event: options.event,
    requestId,
    route: options.route ?? "unknown",
    status: 503,
    subsystem: options.subsystem,
  })

  return NextResponse.json(
    {
      code: options.code,
      error: options.message,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": "3",
        "X-Request-Id": requestId,
      },
      status: 503,
    },
  )
}
