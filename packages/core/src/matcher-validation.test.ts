// Validates the matcher against same/different labels (#114). Each set is a CSV in
// data/ with columns id, kind (material | statement), predicted, gold, same (y/n)
// and votes. Labels come from a blind model panel (data/README.md). A set is
// skipped, with a reason, until every row is labeled.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv } from "./cli/csv.ts";
import { isMatch, MATCH_THRESHOLD, type MatchKind } from "./match.ts";

const SETS = [
  { file: "matcher-validation.csv", what: "hand-written pairs" },
  { file: "matcher-validation-heldout.csv", what: "dev-split extractions" },
  { file: "matcher-validation-blind.csv", what: "test-split extractions, blind" },
];

for (const set of SETS) {
  const csv = readFileSync(join(import.meta.dirname, "..", "..", "..", "data", set.file), "utf8");
  const [header, ...rows] = parseCsv(csv);
  const col = (name: string) => header?.indexOf(name) ?? -1;
  const labeled = rows.filter((r) => /^[yn]/i.test(r[col("same")] ?? ""));
  const disagreements = labeled.filter((r) => {
    const panel = /^y/i.test(r[col("same")] ?? "");
    const kind = r[col("kind")] as MatchKind;
    return panel !== isMatch(r[col("predicted")] ?? "", r[col("gold")] ?? "", kind);
  });

  describe(`matcher vs panel labels: ${set.file} (${set.what})`, () => {
    it("has ≥ 50 pairs of a known kind", () => {
      expect(rows.length).toBeGreaterThanOrEqual(50);
      for (const r of rows) expect(["material", "statement"]).toContain(r[col("kind")]);
    });

    it.skipIf(labeled.length < rows.length)(
      `agrees with ≥ 90% of labels at threshold ${MATCH_THRESHOLD} (${labeled.length}/${rows.length} labeled)`,
      () => {
        const agree = 1 - disagreements.length / labeled.length;
        expect(
          agree,
          `disagrees on ${disagreements.map((r) => r[col("id")]).join(", ")}`,
        ).toBeGreaterThanOrEqual(0.9);
      },
    );
  });
}
