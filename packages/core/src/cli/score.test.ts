import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ScoreReportSchema } from "../report.ts";
import { main } from "./score.ts";

const fixtures = join(import.meta.dirname, "..", "..", "fixtures", "scoring");

describe("pnpm score CLI", () => {
  it("scores the demo set and writes a report that satisfies the contract", () => {
    const out = join(mkdtempSync(join(tmpdir(), "jobtrail-score-")), "report.json");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const code = main([
      "--gold", join(fixtures, "gold.jsonl"),
      "--pred", join(fixtures, "pred.jsonl"),
      "--out", out,
    ]); // prettier-ignore
    expect(code).toBe(0);
    const report = ScoreReportSchema.parse(JSON.parse(readFileSync(out, "utf8")));
    expect(report.overall.n).toBe(3);
    expect(report.overall.zeroEditRate).toBeCloseTo(1 / 3, 10);
    expect(report.overall.hallucinationRate).toBeCloseTo(1 / 6, 10);
    expect(log.mock.calls[0]?.[0]).toContain("zero-edit");
    vi.restoreAllMocks();
  });

  it("exits with usage (code 2) when inputs are missing", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(main([])).toBe(2);
    vi.restoreAllMocks();
  });
});
