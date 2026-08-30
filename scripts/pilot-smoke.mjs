#!/usr/bin/env node

const baseUrl = parseBaseUrl(process.env.PILOT_BASE_URL);
const requireDatabase = process.env.PILOT_REQUIRE_DATABASE !== "false";
const forbiddenQuestionFields = [
  "acceptedAnswers",
  "answer",
  "hints",
  "matchTerms",
  "misconceptions",
  "numericValue",
  "solutionSteps",
  "tolerance",
];

async function main() {
  const healthResponse = await request("/api/health/database");
  const health = await json(healthResponse, "database health");
  assert(
    healthResponse.status === 200,
    "Database health endpoint must return 200.",
  );
  if (requireDatabase) {
    assert(health.status === "healthy", "Production database must be healthy.");
    assert(
      health.database?.required === true &&
        health.database?.status === "healthy",
      "Production database must be required and healthy.",
    );
  }

  const listResponse = await request("/api/questions");
  const list = await json(listResponse, "published question list");
  assert(
    listResponse.status === 200,
    "Published question list must return 200.",
  );
  assert(
    Array.isArray(list.questions) && list.questions.length > 0,
    "Published question list must contain at least one question.",
  );
  assertNoForbiddenQuestionFields(list.questions, "question list");

  const questionId = list.questions[0]?.id;
  assert(
    typeof questionId === "string" && questionId.length > 0,
    "Published question must have an id.",
  );
  const detailResponse = await request(
    `/api/questions/${encodeURIComponent(questionId)}`,
  );
  const detail = await json(detailResponse, "published question detail");
  assert(
    detailResponse.status === 200,
    "Published question detail must return 200.",
  );
  assertNoForbiddenQuestionFields([detail.question], "question detail");

  const dashboardResponse = await request("/dashboard", { redirect: "manual" });
  const dashboardLocation = dashboardResponse.headers.get("location") ?? "";
  assert(
    [301, 302, 303, 307, 308].includes(dashboardResponse.status) &&
      dashboardLocation.includes("/sign-in"),
    "Signed-out dashboard access must redirect to sign-in.",
  );

  const professorResponse = await request("/api/professor/analytics");
  assert(
    professorResponse.status === 401 || professorResponse.status === 403,
    "Signed-out professor API access must be denied.",
  );

  console.log(
    JSON.stringify({
      checks: 5,
      databaseRequired: requireDatabase,
      publishedQuestionCount: list.questions.length,
      status: "passed",
    }),
  );
}

async function request(pathname, init = {}) {
  const url = new URL(pathname, baseUrl);
  return fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      accept: "application/json",
      "user-agent": "ai-tutor-pilot-smoke/1",
      ...init.headers,
    },
    signal: AbortSignal.timeout(8_000),
  });
}

async function json(response, label) {
  const contentType = response.headers.get("content-type") ?? "";
  assert(
    contentType.includes("application/json"),
    `${label} must return JSON (received ${response.status}).`,
  );
  return response.json();
}

function assertNoForbiddenQuestionFields(questions, label) {
  for (const question of questions) {
    assert(question && typeof question === "object", `${label} is malformed.`);
    for (const field of forbiddenQuestionFields) {
      assert(
        !Object.hasOwn(question, field),
        `${label} exposes forbidden field: ${field}.`,
      );
    }
  }
}

function parseBaseUrl(value) {
  assert(value, "PILOT_BASE_URL is required.");
  const url = new URL(value);
  const local = new Set(["127.0.0.1", "localhost", "[::1]"]).has(url.hostname);
  assert(
    url.protocol === "https:" || (local && url.protocol === "http:"),
    "PILOT_BASE_URL must use HTTPS unless it targets localhost.",
  );
  assert(
    url.username === "" && url.password === "",
    "PILOT_BASE_URL must not contain credentials.",
  );
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Smoke test failed.";
  console.error(`Pilot smoke failed: ${message}`);
  process.exitCode = 1;
});
