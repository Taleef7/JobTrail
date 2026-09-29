// Validates the matcher threshold against the owner's same/different labels in
// data/matcher-validation.csv. Skipped (with a reason) until every row is labeled.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MATCH_THRESHOLD, similarity } from "./match.ts";

const csv = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "data", "matcher-validation.csv"),
  "utf8",
);

/** Minimal CSV parsing: quoted fields may contain commas. */
function parseCsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((line) =>
      [...line.matchAll(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)]
        .slice(0, -1)
        .map((m) => (m[1] ?? "").replace(/^"|"$/g, "").replace(/""/g, '"')),
    );
}

const [header, ...rows] = parseCsv(csv);
const col = (name: string) => header?.indexOf(name) ?? -1;
const labeled = rows.filter((r) => /^[yn]/i.test(r[col("same")] ?? ""));

describe("matcher vs human judgments", () => {
  it("has ~50 pairs to judge", () => {
    expect(rows.length).toBeGreaterThanOrEqual(50);
  });

  it.skipIf(labeled.length < rows.length)(
    `agrees with ≥ 90% of human labels at threshold ${MATCH_THRESHOLD} (${labeled.length}/${rows.length} labeled)`,
    () => {
      const agree = labeled.filter((r) => {
        const human = /^y/i.test(r[col("same")] ?? "");
        const machine =
          similarity(r[col("predicted")] ?? "", r[col("gold")] ?? "") >= MATCH_THRESHOLD;
        return human === machine;
      }).length;
      expect(agree / labeled.length).toBeGreaterThanOrEqual(0.9);
    },
  );
});
