import "server-only"

export const DATA_SERVICE_UNAVAILABLE_CODE = "DATA_SERVICE_UNAVAILABLE"
export const DATA_SERVICE_UNAVAILABLE_MESSAGE =
  "Tutor data is temporarily unavailable. Please try again shortly."

export class DataServiceUnavailableError extends Error {
  readonly code = DATA_SERVICE_UNAVAILABLE_CODE
  readonly subsystem: "content" | "tutor-session"

  constructor(
    subsystem: "content" | "tutor-session",
    options?: { cause?: unknown },
  ) {
    super(DATA_SERVICE_UNAVAILABLE_MESSAGE, options)
    this.name = "DataServiceUnavailableError"
    this.subsystem = subsystem
  }
}
