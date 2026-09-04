#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  requiredSafeLabel,
} from "./lib/database-custody.mjs";
import {
  safeHash,
  writeIntegrityEvidence,
} from "./lib/database-integrity-evidence.mjs";

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

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) {
    printUsage();
    return;
  }
  const baseUrl = parseBaseUrl(process.env.PILOT_BASE_URL);
  const requireDatabase = process.env.PILOT_REQUIRE_DATABASE !== "false";
  const results = await runSmoke({ baseUrl, requireDatabase });
  const report = options.evidenceDir
    ? createProductionSmokeEvidence({
        baseUrl,
        changeTicket: process.env.CUSTODY_CHANGE_TICKET,
        confirmDeploymentHash: options.confirmDeploymentHash,
        expectedDeploymentHash: process.env.CUSTODY_EXPECTED_DEPLOYMENT_HASH,
        generatedAt: new Date().toISOString(),
        results,
      })
    : results;
  if (options.evidenceDir) {
    await writeIntegrityEvidence(options.evidenceDir, report);
  }
  console.log(JSON.stringify(report));
}

export async function runSmoke({
  baseUrl,
  fetchImpl = fetch,
  requireDatabase,
}) {
  const healthResponse = await request(
    baseUrl,
    "/api/health/database",
    undefined,
    fetchImpl,
  );
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

  const listResponse = await request(
    baseUrl,
    "/api/questions",
    undefined,
    fetchImpl,
  );
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
    baseUrl,
    `/api/questions/${encodeURIComponent(questionId)}`,
    undefined,
    fetchImpl,
  );
  const detail = await json(detailResponse, "published question detail");
  assert(
    detailResponse.status === 200,
    "Published question detail must return 200.",
  );
  assertNoForbiddenQuestionFields([detail.question], "question detail");

  const dashboardResponse = await request(
    baseUrl,
    "/dashboard",
    { redirect: "manual" },
    fetchImpl,
  );
  const dashboardLocation = dashboardResponse.headers.get("location") ?? "";
  assert(
    [301, 302, 303, 307, 308].includes(dashboardResponse.status) &&
      dashboardLocation.includes("/sign-in"),
    "Signed-out dashboard access must redirect to sign-in.",
  );

  const professorResponse = await request(
    baseUrl,
    "/api/professor/analytics",
    undefined,
    fetchImpl,
  );
  assert(
    professorResponse.status === 401 || professorResponse.status === 403,
    "Signed-out professor API access must be denied.",
  );

  return {
    authorizationBoundaryCheckCount: 2,
    checks: 5,
    databaseHealth: "passed",
    databaseRequired: requireDatabase,
    privacyBoundaryCheckCount: 2,
    publishedQuestionCount: list.questions.length,
    status: "passed",
  };
}

async function request(baseUrl, pathname, init = {}, fetchImpl = fetch) {
  const url = new URL(pathname, baseUrl);
  return fetchImpl(url, {
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

export function createProductionSmokeEvidence({
  baseUrl,
  changeTicket,
  confirmDeploymentHash,
  expectedDeploymentHash,
  generatedAt,
  results,
}) {
  const ticket = requiredSafeLabel(changeTicket, "CUSTODY_CHANGE_TICKET");
  const actualDeploymentHash = safeHash(baseUrl.origin);
  if (
    !/^[0-9a-f]{16}$/.test(expectedDeploymentHash ?? "") ||
    expectedDeploymentHash !== actualDeploymentHash ||
    confirmDeploymentHash !== actualDeploymentHash
  ) {
    throw new Error(
      "The expected and independently confirmed deployment fingerprints must match the smoke target.",
    );
  }
  return {
    artifactVersion: 1,
    audit: "production_rollout_smoke",
    changeTicket: ticket,
    deploymentFingerprint: actualDeploymentHash,
    generatedAt,
    readOnly: true,
    results,
    status: "passed",
    target: "production",
    writesAttempted: 0,
  };
}

export function parseArguments(args) {
  if (args.includes("--help") || args.includes("-h")) return { help: true };
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--evidence-dir") {
      options.evidenceDir = requiredArgumentValue(args, ++index, argument);
    } else if (argument === "--confirm-deployment-hash") {
      options.confirmDeploymentHash = requiredArgumentValue(
        args,
        ++index,
        argument,
      );
    } else {
      throw new Error(`Unknown pilot-smoke option: ${argument}.`);
    }
  }
  if (
    options.evidenceDir &&
    !/^[0-9a-f]{16}$/.test(options.confirmDeploymentHash ?? "")
  ) {
    throw new Error(
      "Production smoke evidence requires --confirm-deployment-hash.",
    );
  }
  return options;
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

function requiredArgumentValue(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function printUsage() {
  console.log(`Usage:
  npm run pilot:smoke
  npm run pilot:smoke -- --evidence-dir docs/evidence/database-custody \\
    --confirm-deployment-hash <safe hash>

Production evidence additionally requires CUSTODY_CHANGE_TICKET and
CUSTODY_EXPECTED_DEPLOYMENT_HASH. The expected hash, command confirmation, and
safe fingerprint of PILOT_BASE_URL must all match. The artifact retains no URL,
host, credential, response body, user identifier, or log message.`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message =
      error instanceof Error ? error.message : "Smoke test failed.";
    console.error(`Pilot smoke failed: ${message}`);
    process.exitCode = 1;
  });
}
