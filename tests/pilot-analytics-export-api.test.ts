import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as exportPilotAnalytics } from "@/app/api/professor/analytics/export/route";
import { emptyPilotAnalyticsExport } from "@/lib/analytics/pilot-export";
import { getPilotAnalyticsExport } from "@/lib/data/data-store";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
  TEST_STUDENT,
} from "./auth-test-helpers";

vi.mock("@/lib/data/data-store", () => ({
  getPilotAnalyticsExport: vi.fn(),
}));

const mockedExport = vi.mocked(getPilotAnalyticsExport);

describe("pilot analytics export API", () => {
  beforeEach(() => {
    mockPrincipal(TEST_PROFESSOR);
    mockedExport.mockResolvedValue(
      emptyPilotAnalyticsExport("2026-08-31T12:00:00.000Z"),
    );
  });

  afterEach(() => {
    resetAuthMocks();
    vi.restoreAllMocks();
  });

  it("fails closed for anonymous and student requests", async () => {
    mockPrincipal(undefined);
    const anonymous = await exportPilotAnalytics(request());

    mockPrincipal(TEST_STUDENT);
    const student = await exportPilotAnalytics(request());

    expect(anonymous.status).toBe(401);
    expect(student.status).toBe(403);
    expect(mockedExport).not.toHaveBeenCalled();
  });

  it("downloads the versioned private no-store JSON document for a professor", async () => {
    const response = await exportPilotAnalytics(request());
    const document = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="pilot-analytics-2026-08-31.json"',
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-request-id")).toMatch(
      /^pilot-[0-9a-f-]{36}$/,
    );
    expect(document).toMatchObject({
      schemaVersion: 2,
      exportType: "pilot_analytics",
      privacy: {
        directIdentifiersIncluded: false,
        rawStudentTextIncluded: false,
      },
    });
    expect(mockedExport).toHaveBeenCalledOnce();
  });

  it("returns a generic service response without exposing storage details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockedExport.mockRejectedValueOnce(
      new Error("DATABASE_URL=postgres://secret-host/private"),
    );

    const response = await exportPilotAnalytics(request());
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(text).toContain("temporarily unavailable");
    expect(text).not.toContain("secret-host");
    expect(text).not.toContain("DATABASE_URL");
  });
});

function request() {
  return new Request("http://test/api/professor/analytics/export", {
    headers: { "x-request-id": "untrusted-client-request-id" },
  });
}
