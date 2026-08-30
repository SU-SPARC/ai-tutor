import { afterEach, describe, expect, it, vi } from "vitest";

import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";
import { authorizeApi, requireStudent } from "@/lib/auth/authorization";
import { setPrincipalResolverForTests } from "@/lib/auth/principal";
import { DataServiceUnavailableError } from "@/lib/data/service-error";
import { DatabaseOperationError } from "@/lib/data/postgres";

afterEach(() => {
  setPrincipalResolverForTests(undefined);
  vi.restoreAllMocks();
});

describe("pilot operational errors", () => {
  it("returns a safe database outage and emits only classified protected diagnostics", async () => {
    const databaseFailure = new DatabaseOperationError("unavailable", {
      retryable: true,
      sqlState: "08006",
    });
    databaseFailure.message =
      "select private_answer from attempts at postgres://admin:secret@db.invalid";
    databaseFailure.stack = "stack containing student answer 0.12345";
    const cause = new DataServiceUnavailableError("tutor-session", {
      cause: databaseFailure,
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = dataServiceUnavailableResponse({
      cause,
      request: new Request("http://test/api/tutor/respond", {
        headers: { "x-request-id": "pilot-request-1234" },
      }),
      route: "/api/tutor/respond",
    });
    const body = await response.text();
    const log = errorLog.mock.calls.flat().join(" ");

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("3");
    expect(response.headers.get("x-request-id")).toMatch(/^pilot-[\w-]{36}$/);
    expect(JSON.parse(body)).toEqual({
      code: "DATA_SERVICE_UNAVAILABLE",
      error: "Tutor data is temporarily unavailable. Please try again shortly.",
    });
    expect(log).toContain('"databaseCategory":"unavailable"');
    expect(log).toContain('"errorClass":"data_service"');
    expect(log).toContain('"retryable":true');
    expect(log).toContain(
      `"requestId":"${response.headers.get("x-request-id")}"`,
    );
    expect(`${body} ${log}`).not.toMatch(
      /select|private_answer|postgres|admin:secret|student answer|0\.12345|08006/i,
    );
  });

  it("converts an identity-provider exception into a safe retryable response", async () => {
    setPrincipalResolverForTests(async () => {
      throw new Error(
        "Clerk response included bearer secret-auth and student@example.invalid",
      );
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const access = await authorizeApi(requireStudent, {
      request: new Request("http://test/api/student/progress", {
        headers: { "x-request-id": "auth-request-1234" },
      }),
      route: "/api/student/progress",
    });

    expect(access.ok).toBe(false);
    if (access.ok) {
      throw new Error("Expected authentication to fail safely.");
    }
    const body = await access.response.text();
    const log = errorLog.mock.calls.flat().join(" ");

    expect(access.response.status).toBe(503);
    expect(access.response.headers.get("retry-after")).toBe("3");
    expect(JSON.parse(body)).toEqual({
      code: "AUTHENTICATION_SERVICE_UNAVAILABLE",
      error: "Sign-in is temporarily unavailable. Please try again shortly.",
    });
    expect(log).toContain('"event":"authentication_unavailable"');
    expect(access.response.headers.get("x-request-id")).toMatch(
      /^pilot-[\w-]{36}$/,
    );
    expect(log).toContain(
      `"requestId":"${access.response.headers.get("x-request-id")}"`,
    );
    expect(`${body} ${log}`).not.toMatch(
      /clerk response|bearer|secret-auth|student@example\.invalid/i,
    );
  });
});
