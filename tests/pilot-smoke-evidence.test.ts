import { describe, expect, it, vi } from "vitest";

import {
  createProductionSmokeEvidence,
  parseArguments,
  runSmoke,
} from "../scripts/pilot-smoke.mjs";
import { safeHash } from "../scripts/lib/database-integrity-evidence.mjs";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function createSmokeFetch(professorStatus = 401) {
  return vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());

    switch (url.pathname) {
      case "/api/health/database":
        return jsonResponse({
          database: { required: true, status: "healthy" },
          status: "healthy",
        });
      case "/api/questions":
        return jsonResponse({
          questions: [{ id: "approved-question", title: "Q" }],
        });
      case "/api/questions/approved-question":
        return jsonResponse({
          question: { id: "approved-question", title: "Q" },
        });
      case "/dashboard":
        return new Response(null, {
          headers: { location: "/sign-in?redirect_url=%2Fdashboard" },
          status: 302,
        });
      case "/api/professor/analytics/export":
        return new Response(null, { status: professorStatus });
      default:
        return new Response(null, { status: 404 });
    }
  });
}

function requestedPaths(fetchImpl: ReturnType<typeof createSmokeFetch>) {
  return fetchImpl.mock.calls.map(([input]) =>
    new URL(input instanceof Request ? input.url : input.toString()).pathname,
  );
}

describe("ticketed Production smoke evidence", () => {
  it("covers health, public privacy, and signed-out authorization boundaries", async () => {
    const fetchImpl = createSmokeFetch();

    await expect(
      runSmoke({
        baseUrl: new URL("https://production.example.edu"),
        fetchImpl: fetchImpl as typeof fetch,
        requireDatabase: true,
      }),
    ).resolves.toEqual({
      authorizationBoundaryCheckCount: 2,
      checks: 5,
      databaseHealth: "passed",
      databaseRequired: true,
      privacyBoundaryCheckCount: 2,
      publishedQuestionCount: 1,
      status: "passed",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(requestedPaths(fetchImpl)).toEqual([
      "/api/health/database",
      "/api/questions",
      "/api/questions/approved-question",
      "/dashboard",
      "/api/professor/analytics/export",
    ]);
  });

  it.each([200, 403, 404, 500])(
    "fails when the anonymous professor authorization probe returns %i",
    async (professorStatus) => {
      const fetchImpl = createSmokeFetch(professorStatus);

      await expect(
        runSmoke({
          baseUrl: new URL("https://production.example.edu"),
          fetchImpl: fetchImpl as typeof fetch,
          requireDatabase: true,
        }),
      ).rejects.toThrow(
        "Signed-out professor analytics export access must return 401.",
      );
      expect(requestedPaths(fetchImpl).at(-1)).toBe(
        "/api/professor/analytics/export",
      );
    },
  );

  it("fails closed if the script requests an unrecognized route", async () => {
    const fetchImpl = createSmokeFetch();

    const missingRouteResponse = await fetchImpl(
      new URL("https://production.example.edu/api/professor/analytics"),
    );

    expect(missingRouteResponse.status).toBe(404);
  });

  it("binds retained output to the ticket and independently confirmed deployment hash", () => {
    const baseUrl = new URL("https://production.example.edu");
    const deploymentHash = safeHash(baseUrl.origin);
    const evidence = createProductionSmokeEvidence({
      baseUrl,
      changeTicket: "DB-CUSTODY-124",
      confirmDeploymentHash: deploymentHash,
      expectedDeploymentHash: deploymentHash,
      generatedAt: "2026-09-04T18:15:00.000Z",
      results: { checks: 5, status: "passed" },
    });

    expect(evidence).toMatchObject({
      changeTicket: "DB-CUSTODY-124",
      deploymentFingerprint: deploymentHash,
      readOnly: true,
      status: "passed",
      target: "production",
      writesAttempted: 0,
    });
    expect(JSON.stringify(evidence)).not.toContain(baseUrl.origin);
    expect(() =>
      createProductionSmokeEvidence({
        baseUrl,
        changeTicket: "DB-CUSTODY-124",
        confirmDeploymentHash: "b".repeat(16),
        expectedDeploymentHash: deploymentHash,
        generatedAt: "2026-09-04T18:15:00.000Z",
        results: { checks: 5, status: "passed" },
      }),
    ).toThrow(/fingerprints/);
  });

  it("requires an explicit deployment confirmation when retaining evidence", () => {
    expect(() =>
      parseArguments([
        "--evidence-dir",
        "docs/evidence/database-custody",
      ]),
    ).toThrow(/confirm-deployment-hash/);
    expect(
      parseArguments([
        "--evidence-dir",
        "docs/evidence/database-custody",
        "--confirm-deployment-hash",
        "a".repeat(16),
      ]),
    ).toEqual({
      confirmDeploymentHash: "a".repeat(16),
      evidenceDir: "docs/evidence/database-custody",
    });
  });
});
