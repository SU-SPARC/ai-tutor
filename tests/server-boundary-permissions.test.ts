import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as claimAnonymous } from "@/app/api/account/claim-anonymous/route";
import { POST as discardAnonymous } from "@/app/api/account/discard-anonymous/route";
import {
  GET as getAdminQuestions,
  PATCH as patchAdminQuestions,
} from "@/app/api/professor/questions/route";
import { PATCH as patchAdminQuestion } from "@/app/api/professor/questions/[id]/route";
import { POST as regenerateAdminQuestion } from "@/app/api/professor/questions/[id]/regenerate/route";
import { POST as uploadAdminContent } from "@/app/api/professor/content-preview/route";
import { POST as claimLegacyAnonymous } from "@/app/api/identity/legacy-anonymous/route";
import { GET as getProfessorAnalytics } from "@/app/api/professor/analytics/route";
import {
  GET as getProfessorReview,
  PATCH as patchProfessorReview,
  POST as postProfessorReview,
} from "@/app/api/professor/review/route";
import { POST as uploadProfessorReview } from "@/app/api/professor/upload/route";
import { POST as searchRetrieval } from "@/app/api/retrieval/search/route";
import { GET as getStudentProgress } from "@/app/api/student/progress/route";
import { POST as respondToTutor } from "@/app/api/tutor/respond/route";
import { POST as recordAttempt } from "@/app/api/tutor/session/[sessionId]/attempt/route";
import { POST as revealHint } from "@/app/api/tutor/session/[sessionId]/hint/route";
import { GET as getTutorSessionRoute } from "@/app/api/tutor/session/[sessionId]/route";
import { POST as revealStep } from "@/app/api/tutor/session/[sessionId]/step/route";
import { POST as createTutorSessionRoute } from "@/app/api/tutor/session/route";
import { SERVER_BOUNDARY_PERMISSION_MATRIX } from "@/lib/auth/server-boundary-policy";
import {
  mockPrincipal,
  mockStudentOwner,
  resetAuthMocks,
  TEST_PROFESSOR,
  TEST_STUDENT,
} from "./auth-test-helpers";

const APP_ROOT = path.join(process.cwd(), "src/app");

beforeEach(() => {
  vi.stubEnv("APP_DEMO_MODE", "true");
  vi.stubEnv("LEGACY_ANONYMOUS_MIGRATION_ENABLED", "true");
  vi.stubEnv(
    "LEGACY_ANONYMOUS_MIGRATION_EXPIRES_AT",
    "2099-01-01T00:00:00.000Z",
  );
});

afterEach(() => {
  resetAuthMocks();
  vi.unstubAllEnvs();
});

describe("server boundary permission matrix", () => {
  it("inventories every page, layout, route-handler method, and Server Action", async () => {
    const files = await walkFiles(APP_ROOT);
    const discovered = new Set<string>();

    for (const absoluteFile of files) {
      const relativeFile = path
        .relative(process.cwd(), absoluteFile)
        .split(path.sep)
        .join("/");
      const source = await readFile(absoluteFile, "utf8");

      if (absoluteFile.endsWith(`${path.sep}page.tsx`)) {
        discovered.add(`PAGE ${appRouteFor(absoluteFile, "page.tsx")}`);
      }

      if (absoluteFile.endsWith(`${path.sep}layout.tsx`)) {
        discovered.add(`LAYOUT ${appRouteFor(absoluteFile, "layout.tsx")}`);
      }

      if (absoluteFile.endsWith(`${path.sep}route.ts`)) {
        const routePath = appRouteFor(absoluteFile, "route.ts");
        const methods = new Set(
          [
            ...source.matchAll(
              /export async function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g,
            ),
          ].map((match) => match[1]),
        );

        if (/export const \{ GET, POST \} = handlers/.test(source)) {
          methods.add("GET");
          methods.add("POST");
        }

        for (const method of methods) {
          discovered.add(`${method} ${routePath}`);
        }
      }

      if (/^["']use server["'];/m.test(source)) {
        for (const match of source.matchAll(
          /export async function ([A-Za-z_$][\w$]*)\b/g,
        )) {
          discovered.add(`ACTION ${match[1]}`);
        }
      }

      const matrixEntries = SERVER_BOUNDARY_PERMISSION_MATRIX.filter(
        (entry) => entry.file === relativeFile,
      );
      for (const entry of matrixEntries) {
        for (const marker of entry.enforcementMarkers) {
          expect(source, `${entry.boundary} must enforce ${marker}`).toContain(
            marker,
          );
        }
      }
    }

    const declared = SERVER_BOUNDARY_PERMISSION_MATRIX.map(
      (entry) => entry.boundary,
    );
    expect(new Set(declared).size).toBe(declared.length);
    expect([...discovered].sort()).toEqual([...declared].sort());
  });

  it("has no student-data export endpoint", async () => {
    const files = await walkFiles(path.join(APP_ROOT, "api"));
    const apiPaths = files
      .filter((file) => file.endsWith(`${path.sep}route.ts`))
      .map((file) => appRouteFor(file, "route.ts"));

    expect(
      apiPaths.some((routePath) => /export|download/i.test(routePath)),
    ).toBe(false);
    expect(
      SERVER_BOUNDARY_PERMISSION_MATRIX.some((entry) =>
        /export|download/i.test(entry.boundary),
      ),
    ).toBe(false);
  });
});

describe("direct professor API authorization", () => {
  const boundaries = [
    ["GET /api/professor/analytics", () => getProfessorAnalytics()],
    [
      "GET /api/professor/review",
      () => getProfessorReview(new Request("http://test/api/professor/review")),
    ],
    [
      "PATCH /api/professor/review",
      () =>
        patchProfessorReview(
          jsonRequest(
            "http://test/api/professor/review",
            {
              action: "reject",
              candidateId: "candidate:test",
            },
            "PATCH",
          ),
        ),
    ],
    [
      "POST /api/professor/review",
      () =>
        postProfessorReview(
          jsonRequest("http://test/api/professor/review", {
            action: "reject",
            candidateId: "candidate:test",
          }),
        ),
    ],
    [
      "POST /api/professor/upload",
      () =>
        uploadProfessorReview(
          jsonRequest("http://test/api/professor/upload", { questions: [] }),
        ),
    ],
    [
      "POST /api/retrieval/search",
      () =>
        searchRetrieval(
          jsonRequest("http://test/api/retrieval/search", {
            query: "binomial",
          }),
        ),
    ],
  ] as const;

  it.each(boundaries)(
    "returns 401 for a direct anonymous call to %s",
    async (_name, call) => {
      mockPrincipal(undefined);

      expect((await call()).status).toBe(401);
    },
  );

  it.each(boundaries)(
    "returns 403 for a direct student call to %s",
    async (_name, call) => {
      mockPrincipal(TEST_STUDENT);

      expect((await call()).status).toBe(403);
    },
  );
});

describe("direct professor content API authorization", () => {
  const boundaries = [
    [
      "GET /api/professor/questions",
      () =>
        getAdminQuestions(new Request("http://test/api/professor/questions")),
    ],
    [
      "PATCH /api/professor/questions",
      () =>
        patchAdminQuestions(
          jsonRequest(
            "http://test/api/professor/questions",
            { action: "reject", questionId: "question:test" },
            "PATCH",
          ),
        ),
    ],
    [
      "PATCH /api/professor/questions/[id]",
      () =>
        patchAdminQuestion(
          jsonRequest(
            "http://test/api/professor/questions/question:test",
            { reviewStatus: "needs_review" },
            "PATCH",
          ),
          routeContext("question:test", "id"),
        ),
    ],
    [
      "POST /api/professor/questions/[id]/regenerate",
      () =>
        regenerateAdminQuestion(
          jsonRequest(
            "http://test/api/professor/questions/question:test/regenerate",
            { keepPattern: true },
          ),
          routeContext("question:test", "id"),
        ),
    ],
    [
      "POST /api/professor/content-preview",
      () =>
        uploadAdminContent(
          new Request("http://test/api/professor/content-preview", {
            method: "POST",
          }),
        ),
    ],
  ] as const;

  it.each(boundaries)(
    "returns 401 for a direct anonymous call to %s",
    async (_name, call) => {
      mockPrincipal(undefined);

      expect((await call()).status).toBe(401);
    },
  );

  it.each(boundaries)(
    "returns 403 for a direct student call to %s",
    async (_name, call) => {
      mockPrincipal(TEST_STUDENT);

      expect((await call()).status).toBe(403);
    },
  );

  it.each(boundaries)(
    "passes the role gate for a direct professor call to %s",
    async (_name, call) => {
      mockPrincipal(TEST_PROFESSOR);

      expect([401, 403]).not.toContain((await call()).status);
    },
  );
});

describe("direct student API authorization", () => {
  it.each([
    ["POST /api/account/claim-anonymous", () => claimAnonymous()],
    ["POST /api/account/discard-anonymous", () => discardAnonymous()],
    [
      "POST /api/identity/legacy-anonymous",
      () =>
        claimLegacyAnonymous(
          jsonRequest("http://test/api/identity/legacy-anonymous", {
            legacyAnonymousId: "anon:11111111-1111-4111-8111-111111111111",
          }),
        ),
    ],
    ["GET /api/student/progress", () => getStudentProgress()],
    [
      "POST /api/tutor/session",
      () =>
        createTutorSessionRoute(
          jsonRequest("http://test/api/tutor/session", {
            questionId: "dice-sum-eight",
          }),
        ),
    ],
  ] as const)(
    "returns 401 without a user or signed anonymous identity for %s",
    async (_name, call) => {
      mockPrincipal(undefined);
      mockStudentOwner(undefined);

      expect((await call()).status).toBe(401);
    },
  );

  it.each([
    [
      "GET /api/tutor/session/[sessionId]",
      () =>
        getTutorSessionRoute(
          new Request("http://test/api/tutor/session/session:test"),
          sessionContext("session:test"),
        ),
    ],
    [
      "POST /api/tutor/session/[sessionId]/attempt",
      () =>
        recordAttempt(
          jsonRequest("http://test/api/tutor/session/session:test/attempt", {
            answer: "1/2",
          }),
          sessionContext("session:test"),
        ),
    ],
    [
      "POST /api/tutor/session/[sessionId]/hint",
      () =>
        revealHint(
          new Request("http://test/api/tutor/session/session:test/hint", {
            method: "POST",
          }),
          sessionContext("session:test"),
        ),
    ],
    [
      "POST /api/tutor/session/[sessionId]/step",
      () =>
        revealStep(
          new Request("http://test/api/tutor/session/session:test/step", {
            method: "POST",
          }),
          sessionContext("session:test"),
        ),
    ],
    [
      "POST /api/tutor/respond",
      () =>
        respondToTutor(
          jsonRequest("http://test/api/tutor/respond", {
            answer: "1/2",
            mode: "check",
            sessionId: "session:test",
          }),
        ),
    ],
  ] as const)(
    "conceals a direct owner-sensitive call with 404 for %s",
    async (_name, call) => {
      mockPrincipal(undefined);
      mockStudentOwner(undefined);

      expect((await call()).status).toBe(404);
    },
  );
});

async function walkFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const absolutePath = path.join(directory, entry.name);
      return entry.isDirectory() ? walkFiles(absolutePath) : [absolutePath];
    }),
  );
  return files.flat();
}

function appRouteFor(absoluteFile: string, filename: string) {
  const relativeDirectory = path.relative(APP_ROOT, path.dirname(absoluteFile));
  const segments = relativeDirectory
    .split(path.sep)
    .filter((segment) => segment && !/^\(.+\)$/.test(segment));

  if (!absoluteFile.endsWith(filename)) {
    throw new Error(`Unexpected App Router file: ${absoluteFile}`);
  }

  return segments.length > 0 ? `/${segments.join("/")}` : "/";
}

function jsonRequest(url: string, body: unknown, method = "POST") {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method,
  });
}

function sessionContext(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

function routeContext<Key extends string>(value: string, key: Key) {
  return { params: Promise.resolve({ [key]: value }) } as {
    params: Promise<Record<Key, string>>;
  };
}
