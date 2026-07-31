import "server-only"

import {
  DatabaseOperationError,
  type DatabaseErrorCategory,
} from "@/lib/data/postgres"

export const DATA_SERVICE_UNAVAILABLE_CODE = "DATA_SERVICE_UNAVAILABLE"
export const DATA_SERVICE_UNAVAILABLE_MESSAGE =
  "Tutor data is temporarily unavailable. Please try again shortly."

export class DataServiceUnavailableError extends Error {
  readonly code = DATA_SERVICE_UNAVAILABLE_CODE
  readonly databaseCategory?: DatabaseErrorCategory
  readonly retryable: boolean
  readonly subsystem: "content" | "tutor-session"

  constructor(
    subsystem: "content" | "tutor-session",
    options?: { cause?: unknown },
  ) {
    super(DATA_SERVICE_UNAVAILABLE_MESSAGE)
    this.name = "DataServiceUnavailableError"
    this.subsystem = subsystem
    this.databaseCategory =
      options?.cause instanceof DatabaseOperationError
        ? options.cause.category
        : undefined
    this.retryable =
      options?.cause instanceof DatabaseOperationError
        ? options.cause.retryable
        : false
  }
}
