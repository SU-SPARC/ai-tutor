import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/professor/operations/route";
import {
  logPilotOperationalEvent,
  resetPilotOperationalDiagnosticsForTests,
} from "@/lib/observability/pilot-operations";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
  TEST_STUDENT,
} from "./auth-test-helpers";

beforeEach(() => {
  resetPilotOperationalDiagnosticsForTests();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  resetAuthMocks();
  resetPilotOperationalDiagnosticsForTests();
  vi.restoreAllMocks();
});

describe("professor operational diagnostics", () => {
  it("denies a student access to operational diagnostics", async () => {
    mockPrincipal(TEST_STUDENT);

    const response = await GET(
      new Request("http://test/api/professor/operations"),
    );

    expect(response.status).toBe(403);
  });

  it("returns only bounded classified diagnostics to a professor", async () => {
    mockPrincipal(TEST_PROFESSOR);
    logPilotOperationalEvent({
      cause: new Error(
        "student answer 0.987 and postgres://admin:secret@private.invalid",
      ),
      event: "data_service_unavailable",
      requestId: "pilot-safe-random-id",
      route: "/api/tutor/respond",
      status: 503,
      subsystem: "tutor-session",
    });

    const response = await GET(
      new Request("http://test/api/professor/operations"),
    );
    const body = await response.text();
    const payload = JSON.parse(body) as {
      diagnostics: Array<Record<string, unknown>>;
      scope: string;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(payload.diagnostics).toEqual([
      expect.objectContaining({
        errorClass: "unexpected",
        event: "data_service_unavailable",
        requestId: "pilot-safe-random-id",
        route: "/api/tutor/respond",
        status: 503,
        subsystem: "tutor-session",
      }),
    ]);
    expect(body).not.toMatch(
      /student answer|0\.987|postgres|admin:secret|private\.invalid/i,
    );
  });
});
