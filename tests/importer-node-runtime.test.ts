import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The importer CLIs import src/lib/tutor/answer/spec.ts directly, so plain Node
// must strip TypeScript types natively (unflagged from Node 22.18).
const MINIMUM_NODE = { major: 22, minor: 18 };
const root = process.cwd();
const packageJson = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
const workflow = readFileSync(
  path.join(root, ".github/workflows/database-migrations.yml"),
  "utf8",
);

function satisfiesMinimum(version: string, allowBareMajor = false) {
  const parts = version.replace(/^v/, "").split(".");
  const major = Number(parts[0]);
  if (parts.length === 1) return allowBareMajor && major >= MINIMUM_NODE.major;
  const minor = Number(parts[1]);
  return (
    major > MINIMUM_NODE.major ||
    (major === MINIMUM_NODE.major && minor >= MINIMUM_NODE.minor)
  );
}

describe("importer CLIs under plain Node", () => {
  it("declares the runtime requirement and runs on a runtime that satisfies it", () => {
    expect(packageJson.engines).toEqual({ node: ">=22.18" });
    expect(satisfiesMinimum(process.versions.node)).toBe(true);
  });

  it.each([
    ["scripts/lib/approved-content-import.mjs"],
    ["scripts/lib/review-candidate-import.mjs"],
  ])("%s imports the TypeScript answer-spec validator directly", (file) => {
    expect(readFileSync(path.join(root, file), "utf8")).toContain(
      'from "../../src/lib/tutor/answer/spec.ts"',
    );
  });

  it.each([
    [
      "scripts/import-approved-content.mjs",
      /npm run db:import:approved -- --manifest <path>/,
    ],
    [
      "scripts/import-review-candidates.mjs",
      /npm run db:import:review-candidates -- --target/,
    ],
  ])(
    "%s starts with --help under plain Node without a database",
    (script, usage) => {
      const result = spawnSync(
        process.execPath,
        [path.join(root, script), "--help"],
        {
          cwd: root,
          encoding: "utf8",
          // No database, manifest, or credential variables reach the process.
          env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH ?? "" },
          timeout: 30_000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.stderr).not.toMatch(
        /ERR_UNKNOWN_FILE_EXTENSION|ERR_MODULE_NOT_FOUND|SyntaxError|TypeError|ReferenceError/,
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(usage);
    },
  );

  it("is exercised by CI on a compatible Node version without secrets", () => {
    const declared = workflow.match(/node-version:\s*"?([0-9][0-9.]*)"?/)?.[1];
    expect(declared).toBeDefined();
    // A bare major such as 22 resolves to the newest 22.x release, past 22.18.
    expect(satisfiesMinimum(declared!, true)).toBe(true);
    expect(workflow).toContain(
      "node scripts/import-approved-content.mjs --help",
    );
    expect(workflow).toContain(
      "node scripts/import-review-candidates.mjs --help",
    );
    expect(workflow).toContain("tests/importer-node-runtime.test.ts");
    expect(workflow).not.toMatch(/--apply|--dry-run|--check\b/);
    expect(packageJson.scripts["test:migrations"]).toContain(
      "tests/importer-node-runtime.test.ts",
    );
    for (const document of [
      "docs/approved-content-import.md",
      "docs/database-operations.md",
    ]) {
      const text = readFileSync(path.join(root, document), "utf8");
      expect(text).toContain("22.18");
      expect(text).toMatch(/TypeScript answer-spec validator/);
    }
  });
});
