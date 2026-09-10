import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { numericAnswerMatches } from "@/lib/tutor/answer/rational";

// Execute the real, unchanged function from migration 015, not a SQL copy.
const migration = readFileSync(
  "db/migrations/015_question_publication_quality_gates.sql",
  "utf8",
);
const start = migration.indexOf(
  "create or replace function app_publication_numeric_answer_matches(",
);
const sql = migration.slice(start, migration.indexOf("\n$$;", start) + 4);
const cases: Array<[string, number, number, boolean]> = [
  ["7", 7, 0, true],
  ["+7", 7, 0, true],
  ["-7", -7, 0, true],
  ["0.5", 0.5, 0, true],
  ["0.50", 0.5, 0, true],
  ["-0.5", -0.5, 0, true],
  ["1/2", 0.5, 0, true],
  ["2 / 4", 0.5, 0, true],
  ["-3/6", -0.5, 0, true],
  ["1/-2", -0.5, 0, true],
  ["1.5/3", 0.5, 0, true],
  ["50%", 0.5, 0, true],
  ["+50%", 0.5, 0, true],
  ["-50%", -0.5, 0, true],
  ["0.5005", 0.5, 0.001, true],
  ["0.502", 0.5, 0.001, false],
  ["0.499", 0.5, 0.001, false], // Preserve the SQL double-precision boundary.
  ["1/3", 1 / 3, 0, true],
  ["0.5000000005", 0.5, 0, true],
  ["9007199254740993/3", 3002399751580331, 0, false],
  ["9007199254740993/3", Number("9007199254740993") / 3, 0, true],
  [
    "99999999999999999999999999999999%",
    Number("99999999999999999999999999999999") / 100,
    0,
    true,
  ],
  ["1/0", 0.5, 0.001, false],
  ["abc", 0.5, 0.001, false],
  ["1 2", 12, 0, false],
  ["", 0, 0, false],
];

describe("publication numeric grammar SQL parity", () => {
  let database: PGlite;
  beforeAll(async () => {
    database = new PGlite();
    await database.exec(sql);
  });
  afterAll(async () => database.close());
  it.each(cases)(
    "%s against %s within %s",
    async (answer, value, tolerance, expected) => {
      const result = await database.query<{ matches: boolean }>(
        "select app_publication_numeric_answer_matches($1, $2, $3) as matches",
        [answer, value, tolerance],
      );
      expect(result.rows[0].matches).toBe(expected);
      expect(numericAnswerMatches(answer, value, tolerance)).toBe(
        result.rows[0].matches,
      );
    },
  );
});
