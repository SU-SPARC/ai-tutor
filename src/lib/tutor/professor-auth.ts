import "server-only"

import { timingSafeEqual } from "crypto"

import { getServerEnv } from "@/lib/env/server"

type AuthResult =
  | {
      authorized: true
      status: 200
    }
  | {
      authorized: false
      reason: string
      status: 401 | 503
    }

export function authorizeProfessorReview(headers: Headers): AuthResult {
  const configuredToken = getServerEnv().ADMIN_SECRET

  if (!configuredToken) {
    return {
      authorized: false,
      reason:
        "Professor review updates are disabled until ADMIN_SECRET is configured on the server.",
      status: 503,
    }
  }

  const suppliedToken =
    headers.get("x-professor-token") ??
    headers.get("authorization")?.replace(/^Bearer\s+/i, "")

  if (!suppliedToken || !tokensMatch(configuredToken, suppliedToken)) {
    return {
      authorized: false,
      reason: "A valid professor review token is required.",
      status: 401,
    }
  }

  return {
    authorized: true,
    status: 200,
  }
}

function tokensMatch(expected: string, actual: string) {
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(actual)

  if (expectedBuffer.length !== actualBuffer.length) {
    return false
  }

  return timingSafeEqual(expectedBuffer, actualBuffer)
}
